import { Application } from "./application";
import {
  type ApplicationRef,
  type CommonUpdateSettings,
  ImageUpdater,
  type LabelSelector,
  type WriteBackConfig,
} from "./image-updater";

// The controller's status cannot tell a failing or no-op rule from a working one,
// so its selection is redone here from the same rules.

/** The controller's default `--interval`. */
export const DEFAULT_INTERVAL_MS = 2 * 60_000;

const MISSED_CHECKS_BEFORE_STALE = 5;

const ANNOTATION_PREFIX = "argocd-image-updater.argoproj.io";

/** Go's `filepath.Match`, as the controller uses it: `*` and `?` stop at `/`. Malformed matches nothing. */
export function globMatches(pattern: string, name: string): boolean {
  let source = "";

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index] as string;

    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "\\") {
      const next = pattern[++index];

      if (next === undefined) return false;
      source += escapeRegExp(next);
    } else if (char === "[") {
      const end = pattern.indexOf("]", index + 2);

      if (end === -1) return false;

      const body = pattern.slice(index + 1, end);
      source += `[${body.startsWith("^") ? `^/${escapeClass(body.slice(1))}` : escapeClass(body)}]`;
      index = end;
    } else source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`).test(name);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function escapeClass(body: string): string {
  return body.replace(/[\]\\]/g, "\\$&");
}

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

export function selectApplications(
  updater: ImageUpdater,
  applications: Application[],
): Selection[] {
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

function isGit(writeBack: WriteBackConfig): boolean {
  return (writeBack.method ?? "argocd").startsWith("git");
}

export function describeWriteBack(writeBack: WriteBackConfig): string {
  if (!isGit(writeBack)) return "the Application, in the cluster";

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

/** One row per watched image, kept even when it reaches no Application. */
export function trackedImages(
  updaters: ImageUpdater[],
  applications: Application[],
): TrackedImage[] {
  const rows: TrackedImage[] = [];

  for (const updater of updaters) {
    const selections = selectApplications(updater, applications);

    for (const ref of ImageUpdater.getApplicationRefs(updater)) {
      const reached = selections.filter((selection) => selection.ref === ref);
      const base = {
        updater: updater.getName(),
        namespace: namespaceOf(updater),
      };

      if (ref.useAnnotations) {
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
              writesToGit: isGit(selection.writeBack),
              fromAnnotations: true,
              applications: [watched(selection, repository)],
            });
          }
        }

        continue;
      }

      for (const image of ref.images ?? []) {
        const { repository, tag } = splitImage(image.imageName);
        const settings = mergeSettings(
          updater.spec?.commonUpdateSettings,
          ref.commonUpdateSettings,
          image.commonUpdateSettings,
        );

        const writeBack = effectiveWriteBack(updater, ref);

        rows.push({
          ...base,
          alias: image.alias,
          repository,
          constraint: tag,
          strategy: settings.updateStrategy,
          allowTags: settings.allowTags,
          ignoreTags: settings.ignoreTags,
          writeBack: describeWriteBack(writeBack),
          writesToGit: isGit(writeBack),
          fromAnnotations: false,
          applications: reached.map((selection) => watched(selection, repository)),
        });
      }
    }
  }

  return rows;
}

export type RuleState =
  | "failing"
  | "errors"
  | "never-checked"
  | "stale"
  | "skipped"
  | "matches-nothing"
  | "waiting"
  | "ok";

export type Tone = "critical" | "warning" | "info" | "ok";

export interface RuleHealth {
  state: RuleState;
  tone: Tone;
  label: string;
  reason: string;
}

export function formatAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);

  if (hours < 48) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function age(timestamp: string | undefined, now: number): number | undefined {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isNaN(parsed) ? undefined : now - parsed;
}

export function ruleHealth(
  updater: ImageUpdater,
  applications: Application[],
  now: number,
  intervalMs = DEFAULT_INTERVAL_MS,
): RuleHealth {
  const ready = ImageUpdater.getCondition(updater, "Ready");
  const error = ImageUpdater.getCondition(updater, "Error");
  const sinceCheck = age(updater.status?.lastCheckedAt, now);

  if (ready?.status === "False") {
    return {
      state: "failing",
      tone: "critical",
      label: "failing",
      reason: `${ready.message} While this rule exists the controller cannot start: it checks every rule as it starts and exits on this one, so a restart leaves it crash-looping.`,
    };
  }

  if (error?.status === "True") {
    return {
      state: "errors",
      tone: "critical",
      label: "errors",
      reason: `${error.message} Ready still says True. Which image and why is only in the controller's log.`,
    };
  }

  if (sinceCheck === undefined) {
    const sinceCreated = now - updater.getCreationTimestamp();

    return sinceCreated > MISSED_CHECKS_BEFORE_STALE * intervalMs
      ? {
          state: "never-checked",
          tone: "critical",
          label: "never checked",
          reason: `Created ${formatAge(sinceCreated)} ago and never checked. Is the controller running, and watching this namespace?`,
        }
      : {
          state: "waiting",
          tone: "info",
          label: "waiting",
          reason: "Waiting for the controller's first check.",
        };
  }

  if (sinceCheck > MISSED_CHECKS_BEFORE_STALE * intervalMs) {
    return {
      state: "stale",
      tone: "warning",
      label: "not checking",
      reason: `Last checked ${formatAge(sinceCheck)} ago, where the controller checks every ${formatAge(intervalMs)} by default. Nothing is being updated meanwhile.`,
    };
  }

  if (!updater.status?.applicationsMatched) {
    const skipped = selectApplications(updater, applications).filter(
      (selection) => selection.skipped,
    );
    const first = skipped[0];

    if (first) {
      const others = skipped.length > 1 ? ` and ${skipped.length - 1} more` : "";

      return {
        state: "skipped",
        tone: "warning",
        label: "nothing updatable",
        reason: `Names ${first.application.getName()}${others}, and the controller skips it: ${first.skipped}.`,
      };
    }

    // Never empty: a rule without references is `failing` above.
    const patterns = ImageUpdater.getApplicationRefs(updater)
      .map((ref) => ref.namePattern)
      .join(", ");

    return {
      state: "matches-nothing",
      tone: "warning",
      label: "matches nothing",
      reason: `No Application in ${updater.getNs()} matches ${patterns}.`,
    };
  }

  const sinceUpdate = age(updater.status?.lastUpdatedAt, now);

  return {
    state: "ok",
    tone: "ok",
    label: "watching",
    reason: `Checked ${formatAge(sinceCheck)} ago. ${
      sinceUpdate === undefined
        ? "Nothing newer has been found since it was created."
        : `Last updated an image ${formatAge(sinceUpdate)} ago.`
    }`,
  };
}

const SEVERITY: Record<RuleState, number> = {
  failing: 0,
  errors: 1,
  "never-checked": 2,
  stale: 3,
  skipped: 4,
  "matches-nothing": 5,
  waiting: 6,
  ok: 7,
};

export function stateRank(state: RuleState): number {
  return SEVERITY[state];
}

export interface RuleRow {
  updater: ImageUpdater;
  health: RuleHealth;
}

export function rankRules(
  updaters: ImageUpdater[],
  applications: Application[],
  now: number,
  intervalMs = DEFAULT_INTERVAL_MS,
): RuleRow[] {
  return updaters
    .map((updater) => ({ updater, health: ruleHealth(updater, applications, now, intervalMs) }))
    .sort(
      (first, second) =>
        SEVERITY[first.health.state] - SEVERITY[second.health.state] ||
        first.updater.getName().localeCompare(second.updater.getName()),
    );
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

export function describeRulesHeadline(
  state: "not-installed" | "connecting" | "unreachable" | "ready",
  needingAttention: number,
  total: number,
): string {
  if (state === "connecting") return "Looking for Image Updater rules…";
  if (state === "unreachable") return "Cannot read the Image Updater rules";
  if (state === "not-installed" || total === 0) return "No Image Updater rules found";
  if (needingAttention === 0) return `All ${total} Image Updater rules are watching`;

  return `${needingAttention} of ${total} Image Updater rules need attention`;
}

export function needingAttention(rows: RuleRow[]): RuleRow[] {
  return rows.filter((row) => row.health.tone === "critical" || row.health.tone === "warning");
}

export function describeRulesState(
  state: "not-installed" | "connecting" | "unreachable" | "ready",
): string | undefined {
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the Image Updater rules, so what is below may be incomplete.";
  }
  if (state === "not-installed") return "This cluster has no ImageUpdater CRD.";

  return undefined;
}

export function countWatching(images: TrackedImage[]): number {
  return images.filter((image) => image.applications.some((watched) => !watched.skipped)).length;
}

/** Image Updater v1.3.0 exits on start if any rule fails, so a restart then crash-loops. */
export function restartRefusal(rows: RuleRow[]): string | undefined {
  const refused = rows.filter((row) => row.health.state === "failing");

  if (refused.length === 0) return undefined;

  const names = refused.map((row) => row.updater.getName()).join(", ");

  return `The controller refuses ${names}, and it does not start while a rule it refuses exists: a restart would leave it crash-looping. Fix or delete ${refused.length === 1 ? "that rule" : "those rules"} first.`;
}
