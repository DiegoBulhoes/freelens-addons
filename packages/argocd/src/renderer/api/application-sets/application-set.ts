import { Renderer } from "@freelensapp/extensions";

import type { Tone } from "../../components/status";
import { Application } from "../applications/application";
import { formatDestination } from "../applications/destinations";
import { knownCount } from "../applications/drawers";
import { sourcesOf } from "../applications/sources";
import type { DrawerState } from "../shared/drawer-state";
import type { LoadState } from "../shared/store-state";
import { plural } from "../shared/text";
import type {
  ApplicationDestination,
  ApplicationSource,
  ArgoCDKubeObjectCRD,
  HealthStatusCode,
  SyncPolicy,
} from "../shared/types";

/** One key names the kind (`list`, `git`, `matrix`…); `selector` filters what it produces. */
export type ApplicationSetGenerator = Record<string, unknown>;

export interface ApplicationSetTemplate {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    project?: string;
    source?: ApplicationSource;
    sources?: ApplicationSource[];
    destination?: ApplicationDestination;
    syncPolicy?: SyncPolicy;
  };
}

export type ApplicationsSync = "create-only" | "create-update" | "create-delete" | "sync";

export interface ApplicationSetSpec {
  generators?: ApplicationSetGenerator[];
  template?: ApplicationSetTemplate;
  goTemplate?: boolean;
  syncPolicy?: { preserveResourcesOnDeletion?: boolean; applicationsSync?: ApplicationsSync };
}

export interface ApplicationSetCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface ApplicationSetStatus {
  conditions?: ApplicationSetCondition[];
  health?: { status?: HealthStatusCode; message?: string };
}

export class ApplicationSet extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  ApplicationSetStatus,
  ApplicationSetSpec
> {
  static override readonly kind = "ApplicationSet";
  static override readonly namespaced = true;
  static override readonly apiBase = "/apis/argoproj.io/v1alpha1/applicationsets";

  static override readonly crd: ArgoCDKubeObjectCRD = {
    apiVersions: ["argoproj.io/v1alpha1"],
    plural: "applicationsets",
    singular: "applicationset",
    shortNames: ["appset", "appsets"],
    title: "ApplicationSets",
  };
}

export class ApplicationSetApi extends Renderer.K8sApi.KubeApi<ApplicationSet> {}
export class ApplicationSetStore extends Renderer.K8sApi.KubeObjectStore<
  ApplicationSet,
  ApplicationSetApi
> {}

export function generatorKind(generator: ApplicationSetGenerator): string {
  return Object.keys(generator).find((key) => key !== "selector") ?? "unknown";
}

function bodyOf(generator: ApplicationSetGenerator): Record<string, unknown> {
  const body = generator[generatorKind(generator)];

  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function nestedOf(generator: ApplicationSetGenerator): ApplicationSetGenerator[] {
  const nested = bodyOf(generator).generators;

  return Array.isArray(nested) ? (nested as ApplicationSetGenerator[]) : [];
}

/** `matrix(git, list)`: a matrix or merge names what it combines. */
export function describeGeneratorKind(generator: ApplicationSetGenerator): string {
  const nested = nestedOf(generator);
  const kind = generatorKind(generator);

  return nested.length > 0 ? `${kind}(${nested.map(describeGeneratorKind).join(", ")})` : kind;
}

export function describeGenerators(set: ApplicationSet): string {
  const generators = set.spec.generators ?? [];

  return generators.length > 0 ? generators.map(describeGeneratorKind).join(", ") : "none";
}

export interface GeneratorView {
  kind: string;
  summary: string;
  /** Each field it sets, as written; a nested generator is its own view. */
  fields: { name: string; value: string }[];
  nested: GeneratorView[];
}

function summaryOf(generator: ApplicationSetGenerator): string {
  const body = bodyOf(generator);
  const kind = generatorKind(generator);

  if (kind === "list") {
    const elements = Array.isArray(body.elements) ? body.elements.length : 0;

    return body.elementsYaml ? "elements from a template" : plural(elements, "element");
  }

  if (kind === "git") {
    const revision = body.revision ? ` @ ${String(body.revision)}` : "";

    return `${String(body.repoURL ?? "?")}${revision}`;
  }

  if (kind === "clusters")
    return body.selector ? "the clusters its selector matches" : "every cluster";

  if (kind === "matrix" || kind === "merge")
    return `combines ${plural(nestedOf(generator).length, "generator")}`;

  return "";
}

export function describeGenerator(generator: ApplicationSetGenerator): GeneratorView {
  const { generators: _nested, ...rest } = bodyOf(generator);
  const shown = generator.selector === undefined ? rest : { ...rest, selector: generator.selector };

  return {
    kind: generatorKind(generator),
    summary: summaryOf(generator),
    fields: Object.entries(shown).map(([name, value]) => ({
      name,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
    nested: nestedOf(generator).map(describeGenerator),
  };
}

/** By owner reference uid: two control planes can each have a set of the same name. */
export function ownedApplications(set: ApplicationSet, applications: Application[]): Application[] {
  const uid = set.getId();

  return applications.filter((application) =>
    application.getOwnerRefs().some((ref) => ref.kind === ApplicationSet.kind && ref.uid === uid),
  );
}

export interface OwnedSummary {
  /** Undefined until the Applications are read for the scope. */
  count: number | undefined;
  tone: Tone;
  label: string;
  /** One line per Application. */
  title: string;
}

const BAD_HEALTH: readonly HealthStatusCode[] = ["Degraded", "Missing"];

export function summariseOwned(owned: Application[], state: LoadState): OwnedSummary {
  const count = knownCount(state, owned.length);

  if (count === undefined) return { count, tone: "info", label: "not read", title: "" };

  const counts = new Map<string, number>();
  let tone: Tone = "ok";

  for (const application of owned) {
    const sync = Application.getSyncStatus(application);
    const health = Application.getHealthStatus(application);

    if (BAD_HEALTH.includes(health)) tone = "critical";
    else if (tone === "ok" && (sync !== "Synced" || health !== "Healthy")) tone = "warning";

    if (sync !== "Synced") counts.set(sync, (counts.get(sync) ?? 0) + 1);
    if (health !== "Healthy") counts.set(health, (counts.get(health) ?? 0) + 1);
  }

  const problems = [...counts].map(([status, count]) => `${count} ${status}`);

  return {
    count,
    tone: owned.length === 0 ? "info" : tone,
    label:
      owned.length === 0
        ? "none"
        : problems.length === 0
          ? "synced and healthy"
          : problems.join(", "),
    title: owned
      .map(
        (application) =>
          `${application.getName()}: ${Application.getSyncStatus(application)}, ${Application.getHealthStatus(application)}`,
      )
      .join("\n"),
  };
}

export interface Verdict extends DrawerState {
  /** The condition's reason, as the controller wrote it. */
  cause?: string;
}

const conditionOf = (set: ApplicationSet, type: string) =>
  set.status?.conditions?.find((condition) => condition.type === type);

function fromCondition(
  condition: ApplicationSetCondition,
  tone: Tone,
  label: string,
  fallback: string,
): Verdict {
  return { tone, label, reason: condition.message || fallback, cause: condition.reason };
}

/** The controller sets all three on each pass; an error explains the other two. */
export function applicationSetVerdict(set: ApplicationSet): Verdict {
  const error = conditionOf(set, "ErrorOccurred");
  const parameters = conditionOf(set, "ParametersGenerated");
  const upToDate = conditionOf(set, "ResourcesUpToDate");

  if (error?.status === "True") {
    return fromCondition(
      error,
      "critical",
      "Error",
      "The controller could not generate its Applications.",
    );
  }
  if (parameters?.status === "False") {
    return fromCondition(
      parameters,
      "critical",
      "No parameters",
      "Its generators produced no parameters.",
    );
  }
  if (upToDate?.status === "False") {
    return fromCondition(
      upToDate,
      "warning",
      "Not up to date",
      "Its Applications do not match what it generates.",
    );
  }
  if (upToDate?.status === "True") {
    return fromCondition(upToDate, "ok", "Up to date", "Its Applications match what it generates.");
  }

  return {
    tone: "info",
    label: "Not reported",
    reason: "The ApplicationSet controller has not reported on it yet.",
  };
}

const TONE_RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

export function verdictRank(verdict: Verdict): number {
  return TONE_RANK[verdict.tone];
}

export function templateSources(set: ApplicationSet): ApplicationSource[] {
  return sourcesOf(set.spec.template?.spec);
}

export function templateDestination(set: ApplicationSet): string {
  return formatDestination(set.spec.template?.spec?.destination);
}

const APPLICATIONS_SYNC: Record<ApplicationsSync, string> = {
  sync: "creates, updates and deletes its Applications",
  "create-only": "creates its Applications, never updates or deletes them",
  "create-update": "creates and updates its Applications, never deletes them",
  "create-delete": "creates and deletes its Applications, never updates them",
};

/** Unset, the controller's own policy applies, which is `sync` unless it was started otherwise. */
export function describeSyncPolicy(set: ApplicationSet): { label: string; value: string }[] {
  const policy = set.spec.syncPolicy;
  const sync = policy?.applicationsSync;

  return [
    {
      label: "Applications sync",
      value: sync
        ? `${sync}: ${APPLICATIONS_SYNC[sync] ?? "a policy this page does not know"}`
        : `the controller's: ${APPLICATIONS_SYNC.sync}, unless it was started with another policy`,
    },
    {
      label: "When deleted",
      value: policy?.preserveResourcesOnDeletion
        ? "deletes its Applications and keeps what they deployed"
        : "deletes its Applications and what they deployed",
    },
  ];
}

export interface ConditionRow {
  type: string;
  status: string;
  reason: string;
  message: string;
  /** True where the condition reports a problem. */
  failing: boolean;
}

const FAILING_WHEN: Record<string, string> = {
  ErrorOccurred: "True",
  ParametersGenerated: "False",
  ResourcesUpToDate: "False",
};

export function conditionRows(set: ApplicationSet): ConditionRow[] {
  return (set.status?.conditions ?? []).map((condition) => ({
    type: condition.type,
    status: condition.status,
    reason: condition.reason ?? "",
    message: condition.message ?? "",
    failing: FAILING_WHEN[condition.type] === condition.status,
  }));
}

export interface ApplicationSetRow {
  set: ApplicationSet;
  verdict: Verdict;
  owned: Application[];
  summary: OwnedSummary;
}

/** Worst first, then by name. */
export function rankApplicationSets(
  sets: ApplicationSet[],
  applications: Application[],
  applicationsState: LoadState,
): ApplicationSetRow[] {
  return sets
    .map((set) => {
      const owned = ownedApplications(set, applications);

      return {
        set,
        verdict: applicationSetVerdict(set),
        owned,
        summary: summariseOwned(owned, applicationsState),
      };
    })
    .sort(
      (a, b) =>
        verdictRank(a.verdict) - verdictRank(b.verdict) ||
        a.set.getName().localeCompare(b.set.getName()),
    );
}

export const SET_COLUMNS = {
  name: "Name",
  namespace: "Namespace",
  generators: "Generators",
  applications: "Applications",
  conditions: "Conditions",
} as const;

export const SET_SORT: Record<string, (row: ApplicationSetRow) => string | number | undefined> = {
  [SET_COLUMNS.name]: (row) => row.set.getName(),
  [SET_COLUMNS.namespace]: (row) => row.set.getNs(),
  [SET_COLUMNS.generators]: (row) => describeGenerators(row.set),
  [SET_COLUMNS.applications]: (row) => row.summary.count ?? -1,
  [SET_COLUMNS.conditions]: (row) => verdictRank(row.verdict),
};

export function setSearchTexts(row: ApplicationSetRow): string[] {
  return [
    row.set.getName(),
    row.set.getNs() ?? "",
    describeGenerators(row.set),
    row.verdict.label,
    ...row.owned.map((application) => application.getName()),
  ];
}

export function describeApplicationSetsState(state: LoadState): string | undefined {
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the ApplicationSets, so what is below may be incomplete.";
  }
  if (state === "not-installed") return "This cluster has no ApplicationSet CRD.";

  return undefined;
}
