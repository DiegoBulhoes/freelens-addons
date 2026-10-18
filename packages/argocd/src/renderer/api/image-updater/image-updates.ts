import { Application } from "../applications/application";
import { globMatches } from "../shared/glob";
import { sameElements } from "../shared/memo";
import {
  type ApplicationRef,
  type CommonUpdateSettings,
  ImageUpdater,
  type LabelSelector,
  type WriteBackConfig,
} from "./image-updater";

// The controller's status cannot tell a failing or no-op rule from a working one,
// so its selection is redone here from the same rules.

const ANNOTATION_PREFIX = "argocd-image-updater.argoproj.io";

export function labelsMatch(
  labels: Partial<Record<string, string>>,
  selector?: LabelSelector,
): boolean {
  if (!selector) return true;

  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[key] !== value) return false;
  }

  for (const { key, operator, values = [] } of selector.matchExpressions ?? []) {
    const present = key in labels;
    const value = labels[key];

    if (operator === "In" && !(present && values.includes(value as string))) return false;
    if (operator === "NotIn" && present && values.includes(value as string)) return false;
    if (operator === "Exists" && !present) return false;
    if (operator === "DoesNotExist" && present) return false;
  }

  return true;
}

/** The controller's precedence: exact name, then most literal characters; a label selector outweighs any name. */
export function specificity(ref: ApplicationRef): number {
  const pattern = ref.namePattern;
  let score = /[*?[\]]/.test(pattern) ? 0 : 1_000_000;

  score += pattern.replace(/\[.*?]/g, "").replace(/[*?]/g, "").length;

  if (ref.labelSelectors) {
    score += 10_000;
    score += Object.keys(ref.labelSelectors.matchLabels ?? {}).length * 100;
    score += (ref.labelSelectors.matchExpressions ?? []).length * 100;
  }

  return score;
}

export function unsupportedReason(
  application: Application,
  writeBack: WriteBackConfig = {},
): string | undefined {
  const target = writeBack.gitConfig?.writeBackTarget ?? "";

  // These targets edit a file in git, which makes even a plain directory source updatable.
  if (target.startsWith("kustomization") || target.startsWith("helmvalues")) return undefined;

  const type = sourceTypeOf(application);

  if (type === "Helm" || type === "Kustomize" || type === "Plugin") return undefined;
  if (!type) return "ArgoCD has not reported its source type yet";

  return `it is a ${type.toLowerCase()} source; only Helm, Kustomize and plugin sources are updated`;
}

function sourceTypeOf(application: Application): string | undefined {
  const status = application.status;

  if (Application.isMultiSource(application)) {
    return (
      status?.sourceTypes?.find((type) => ["Helm", "Kustomize", "Plugin"].includes(type)) ??
      (status?.sourceTypes?.length ? "Directory" : undefined)
    );
  }

  return status?.sourceType;
}

export interface Selection {
  application: Application;
  ref: ApplicationRef;
  writeBack: WriteBackConfig;
  skipped?: string;
}

const lastSelections = new WeakMap<
  ImageUpdater,
  { applications: Application[]; selected: Selection[] }
>();

/** Memoised per rule: pages ask repeatedly with fresh arrays of the same objects, and the store replaces objects. */
export function ruleSelections(updater: ImageUpdater, applications: Application[]): Selection[] {
  const last = lastSelections.get(updater);

  if (last && sameElements(last.applications, applications)) return last.selected;

  const selected = computeRuleSelections(updater, applications);

  lastSelections.set(updater, { applications: [...applications], selected });

  return selected;
}

function computeRuleSelections(updater: ImageUpdater, applications: Application[]): Selection[] {
  const refs = [...ImageUpdater.getApplicationRefs(updater)].sort(
    (first, second) => specificity(second) - specificity(first),
  );
  const selected: Selection[] = [];

  for (const application of applications) {
    if (application.getNs() !== namespaceOf(updater)) continue;

    const ref = refs.find(
      (candidate) =>
        globMatches(candidate.namePattern, application.getName()) &&
        labelsMatch(application.metadata.labels ?? {}, candidate.labelSelectors),
    );

    if (!ref) continue;

    const writeBack = effectiveWriteBack(updater, ref, application);

    selected.push({
      application,
      ref,
      writeBack,
      skipped: unsupportedReason(application, writeBack),
    });
  }

  return selected;
}

function annotationsOf(application: Application): Partial<Record<string, string>> {
  return application.metadata.annotations ?? {};
}

function namespaceOf(object: ImageUpdater): string {
  return object.metadata.namespace as string;
}

function mergeSettings(
  ...layers: (CommonUpdateSettings | undefined)[]
): Required<Pick<CommonUpdateSettings, "updateStrategy">> & CommonUpdateSettings {
  const merged: CommonUpdateSettings = {};

  for (const layer of layers) {
    Object.assign(merged, layer);
  }

  return { ...merged, updateStrategy: merged.updateStrategy ?? "semver" };
}

function effectiveWriteBack(
  updater: ImageUpdater,
  ref: ApplicationRef,
  application?: Application,
): WriteBackConfig {
  if (ref.useAnnotations && application) {
    const annotations = annotationsOf(application);
    const method = annotations[`${ANNOTATION_PREFIX}/write-back-method`];

    return {
      method,
      gitConfig: {
        branch: annotations[`${ANNOTATION_PREFIX}/git-branch`],
        repository: annotations[`${ANNOTATION_PREFIX}/git-repository`],
        writeBackTarget: annotations[`${ANNOTATION_PREFIX}/write-back-target`],
      },
    };
  }

  return { ...updater.spec?.writeBackConfig, ...ref.writeBackConfig };
}

export function writesToGit(writeBack: WriteBackConfig): boolean {
  return (writeBack.method ?? "argocd").startsWith("git");
}

export function describeWriteBack(writeBack: WriteBackConfig): string {
  if (!writesToGit(writeBack)) return "the Application, in the cluster";

  const { repository, branch } = writeBack.gitConfig ?? {};
  const where = [repository ?? "the Application's repository", branch && `branch ${branch}`]
    .filter(Boolean)
    .join(", ");

  return `a commit to ${where}`;
}

/** The port in `host:5000/team/app:1.x` is not a tag. */
export function splitImage(reference: string): { repository: string; tag?: string } {
  const withoutDigest = reference.replace(/@.*$/, "");
  const colon = withoutDigest.lastIndexOf(":");

  if (colon > withoutDigest.lastIndexOf("/")) {
    return { repository: withoutDigest.slice(0, colon), tag: withoutDigest.slice(colon + 1) };
  }

  return { repository: withoutDigest };
}

/** Docker Hub's short and long spellings of the same repository compare equal. */
function canonicalRepository(repository: string): string {
  const withoutHost = repository.replace(/^(index\.)?docker\.io\//, "");

  return withoutHost.includes("/") ? withoutHost.replace(/^library\//, "") : withoutHost;
}

export function runningTag(application: Application, repository: string): string | undefined {
  const wanted = canonicalRepository(repository);

  for (const image of Application.getImages(application)) {
    const { repository: candidate, tag } = splitImage(image);

    if (canonicalRepository(candidate) === wanted) return tag ?? "latest";
  }

  return undefined;
}

export interface WatchedApplication {
  name: string;
  /** Undefined when the Application does not run the image. */
  running?: string;
  skipped?: string;
}

export interface TrackedImage {
  updater: string;
  namespace: string;
  alias: string;
  repository: string;
  constraint?: string;
  strategy: string;
  allowTags?: string;
  ignoreTags?: string[];
  writeBack: string;
  writesToGit: boolean;
  fromAnnotations: boolean;
  applications: WatchedApplication[];
}

/** The pre-1.0 annotation: `alias=repository:constraint, other`. */
function imagesFromAnnotation(list: string): { alias: string; imageName: string }[] {
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const equals = entry.indexOf("=");

      return equals === -1
        ? { alias: splitImage(entry).repository, imageName: entry }
        : { alias: entry.slice(0, equals), imageName: entry.slice(equals + 1) };
    });
}

function watched(selection: Selection, repository: string): WatchedApplication {
  return {
    name: selection.application.getName(),
    running: runningTag(selection.application, repository),
    skipped: selection.skipped,
  };
}

type RowBase = Pick<TrackedImage, "updater" | "namespace">;

/** One row per image in each reached Application's image-list annotation. */
function annotationImageRows(base: RowBase, reached: Selection[]): TrackedImage[] {
  const rows: TrackedImage[] = [];

  for (const selection of reached) {
    const annotations = annotationsOf(selection.application);

    for (const image of imagesFromAnnotation(
      annotations[`${ANNOTATION_PREFIX}/image-list`] ?? "",
    )) {
      const { repository, tag } = splitImage(image.imageName);

      rows.push({
        ...base,
        alias: image.alias,
        repository,
        constraint: tag,
        strategy:
          annotations[`${ANNOTATION_PREFIX}/${image.alias}.update-strategy`] ??
          annotations[`${ANNOTATION_PREFIX}/update-strategy`] ??
          "semver",
        allowTags: annotations[`${ANNOTATION_PREFIX}/${image.alias}.allow-tags`],
        writeBack: describeWriteBack(selection.writeBack),
        writesToGit: writesToGit(selection.writeBack),
        fromAnnotations: true,
        applications: [watched(selection, repository)],
      });
    }
  }

  return rows;
}

/** One row per `ref.images` entry, with the settings merged from the rule, the reference and the image. */
function specImageRows(
  base: RowBase,
  updater: ImageUpdater,
  ref: ApplicationRef,
  reached: Selection[],
): TrackedImage[] {
  return (ref.images ?? []).map((image) => {
    const { repository, tag } = splitImage(image.imageName);
    const settings = mergeSettings(
      updater.spec?.commonUpdateSettings,
      ref.commonUpdateSettings,
      image.commonUpdateSettings,
    );
    const writeBack = effectiveWriteBack(updater, ref);

    return {
      ...base,
      alias: image.alias,
      repository,
      constraint: tag,
      strategy: settings.updateStrategy,
      allowTags: settings.allowTags,
      ignoreTags: settings.ignoreTags,
      writeBack: describeWriteBack(writeBack),
      writesToGit: writesToGit(writeBack),
      fromAnnotations: false,
      applications: reached.map((selection) => watched(selection, repository)),
    };
  });
}

/** One row per watched image, kept even when it reaches no Application. */
export function trackedImages(
  updaters: ImageUpdater[],
  applications: Application[],
): TrackedImage[] {
  const rows: TrackedImage[] = [];

  for (const updater of updaters) {
    const selections = ruleSelections(updater, applications);
    const base = { updater: updater.getName(), namespace: namespaceOf(updater) };

    for (const ref of ImageUpdater.getApplicationRefs(updater)) {
      const reached = selections.filter((selection) => selection.ref === ref);

      rows.push(
        ...(ref.useAnnotations
          ? annotationImageRows(base, reached)
          : specImageRows(base, updater, ref, reached)),
      );
    }
  }

  return rows;
}

export interface UpdateRow {
  updater: string;
  namespace: string;
  alias: string;
  image: string;
  from?: string;
  to: string;
  applications: number;
  at: string;
}

/** The controller keeps only each rule's last cycle, so this is not a log. */
export function recentUpdates(updaters: ImageUpdater[]): UpdateRow[] {
  return updaters
    .flatMap((updater) =>
      (updater.status?.recentUpdates ?? []).map((update) => ({
        updater: updater.getName(),
        namespace: namespaceOf(updater),
        alias: update.alias,
        image: update.image,
        from: /^Updated from (.+) to .+\.$/.exec(update.message ?? "")?.[1],
        to: update.newVersion,
        applications: update.applicationsUpdated,
        at: update.updatedAt,
      })),
    )
    .sort((first, second) => second.at.localeCompare(first.at));
}

export function imagesForApplication(
  application: Application,
  updaters: ImageUpdater[],
): TrackedImage[] {
  return trackedImages(updaters, [application]).filter((row) => row.applications.length > 0);
}

const reachesAnApplication = (image: TrackedImage) =>
  image.applications.some((watched) => !watched.skipped);

/** The Images list's filters; the Overview's cards count with the same ones. */
export const IMAGE_FILTERS = { watching: reachesAnApplication } as const;

export type ImageFilter = keyof typeof IMAGE_FILTERS;

/** The filter a link named, when it names one of `filters`. */
export function filterNamed<Filter extends string>(
  filters: Readonly<Record<Filter, unknown>>,
  value: string | undefined,
): Filter | undefined {
  return value !== undefined && Object.hasOwn(filters, value) ? (value as Filter) : undefined;
}

export function applyFilter<Row, Filter extends string>(
  rows: Row[],
  filters: Readonly<Record<Filter, (row: Row) => boolean>>,
  filter: Filter | undefined,
): Row[] {
  return filter ? rows.filter(filters[filter]) : rows;
}

export function countWatching(images: TrackedImage[]): number {
  return images.filter(reachesAnApplication).length;
}
