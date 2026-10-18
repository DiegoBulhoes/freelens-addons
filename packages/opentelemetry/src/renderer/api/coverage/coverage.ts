import { byNamespace } from "../shared/namespace-scope";
import type { LoadState } from "../shared/store-state";
import type {
  CollectorLike,
  InstrumentationLike,
  NamespaceLike,
  PodLike,
  WorkloadKind,
  WorkloadLike,
} from "../shared/types";
import { needsAttention, type Tone, type Verdict } from "../shared/verdict";
import {
  type Containers,
  containerBlockers,
  containersFor,
  isFalse,
  LANGUAGES,
  type Language,
  type OptIn,
  optInsOf,
  PREFIX,
  pythonBlockers,
} from "./annotations";
import { type Blocker, sidecarBlockers, tlsBlockers } from "./blockers";
import {
  type LanguageSetting,
  languageSetting,
  type OperatorList,
  operatorBlockers,
} from "./operator";
import type { ReferenceNames } from "./reference-names";
import { keyOf, type Resolution, resolveInstrumentation } from "./resolve";
import {
  injectionOf,
  isBatch,
  lastJobOf,
  type PodInjection,
  podsOf,
  standsAlone,
} from "./workload-pods";

export type CoverageState =
  | "no-instrumentation"
  | "ambiguous"
  | "misplaced"
  | "blocked"
  | "restart-needed"
  | "unknown"
  | "pending"
  | "opted-out"
  | "injected";

/** Worst first. */
export const COVERAGE_STATES: readonly CoverageState[] = [
  "no-instrumentation",
  "ambiguous",
  "misplaced",
  "blocked",
  "restart-needed",
  "unknown",
  "pending",
  "opted-out",
  "injected",
];

const COVERAGE_STATUS: Record<CoverageState, { label: string; tone: Tone }> = {
  "no-instrumentation": { label: "No Instrumentation", tone: "critical" },
  ambiguous: { label: "Ambiguous", tone: "critical" },
  misplaced: { label: "Misplaced", tone: "critical" },
  blocked: { label: "Blocked", tone: "critical" },
  "restart-needed": { label: "Restart needed", tone: "warning" },
  unknown: { label: "Unknown", tone: "warning" },
  pending: { label: "Checking", tone: "info" },
  "opted-out": { label: "Opted out", tone: "info" },
  injected: { label: "Injected", tone: "ok" },
};

export interface LanguageRow {
  optIn: OptIn;
  label: string;
  /** Of the value in effect; for a misplaced key, of the value it would have on the template. */
  resolution: Resolution;
  containers: Containers;
  /** Whether the operator injects this language at all. */
  operator: LanguageSetting;
  /** Set when the annotation alone decides the state, whatever the pods are. */
  verdict?: { state: CoverageState; reason: string };
}

export interface CoverageRow {
  key: string;
  workload: WorkloadLike;
  kind: WorkloadKind;
  name: string;
  namespace: string;
  languages: LanguageRow[];
  /** The language whose annotation decided the state. */
  decisive?: LanguageRow;
  instrumentation?: InstrumentationLike;
  pods: PodInjection[];
  /** A CronJob's last Job, whose pods are counted. */
  run?: string;
  injected: number;
  total: number;
  containers: { names: string[]; predicted: boolean };
  blockers: Blocker[];
  state: CoverageState;
  verdict: Verdict;
}

export interface CoverageInventory {
  workloads: WorkloadLike[];
  pods: PodLike[];
  namespaces: NamespaceLike[];
  /** Every namespace's, as a value may name `namespace/name` anywhere; undefined until read. */
  instrumentations?: InstrumentationLike[];
  /** Every namespace's, for a sidecar annotation naming one; undefined until loaded. */
  collectors?: CollectorLike[];
  /** The unread lists the stores gave up on: their rows read Unknown, not Checking. */
  gaveUp?: { instrumentations?: boolean; collectors?: boolean };
  references?: ReferenceNames;
  /** The operator's Deployments, read for its language switches; undefined until read. */
  operator?: OperatorList;
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

function annotationVerdict(
  optIn: OptIn,
  resolution: Resolution,
  kind: WorkloadKind,
  gaveUp: boolean,
): LanguageRow["verdict"] {
  const key = optIn.key.slice(PREFIX.length);

  if (optIn.misplaced) {
    return {
      state: "misplaced",
      reason: `${key} is on the ${kind}'s own annotations, which the operator never reads; it belongs on the pod template.`,
    };
  }
  if (isFalse(optIn.value)) {
    const from = optIn.from === "Namespace" ? "The Namespace" : "The pod template";

    return { state: "opted-out", reason: `${from} sets ${key} to "false".` };
  }
  if (resolution.kind === "missing") {
    return {
      state: "no-instrumentation",
      reason: resolution.name
        ? `${resolution.namespace}/${resolution.name} does not exist.`
        : `No Instrumentation in ${resolution.namespace}.`,
    };
  }
  if (resolution.kind === "unread") {
    return gaveUp
      ? { state: "unknown", reason: "The Instrumentations could not be read." }
      : { state: "pending", reason: "The Instrumentations are not read yet." };
  }
  if (resolution.kind === "ambiguous") {
    return {
      state: "ambiguous",
      reason: `${resolution.candidates.length} Instrumentations in ${resolution.namespace} (${resolution.candidates.join(", ")}); the annotation must name one.`,
    };
  }

  return undefined;
}

const podsWord = (kind: WorkloadKind) => (kind === "CronJob" ? "pods of its last Job" : "pods");
const nextWord = (kind: WorkloadKind) => (isBatch(kind) ? "next run" : "next restart");

function reasonFromPods(
  state: CoverageState,
  kind: WorkloadKind,
  { injected, total }: { injected: number; total: number },
  blockers: Blocker[],
) {
  if (state === "blocked" || state === "unknown" || state === "pending") {
    return blockers
      .filter((blocker) => blocker.certain === (state === "blocked"))
      .map((blocker) => sentence(blocker.text))
      .join(" ");
  }
  if (state === "restart-needed") {
    return `${total - injected} of ${total} pods started without the agent.`;
  }
  if (total === 0) return "No pods; the next one gets the agent.";
  if (injected < total) {
    return `${total - injected} of ${total} ${podsWord(kind)} started without the agent; the next run gets it.`;
  }

  const certain = blockers.filter((blocker) => blocker.certain).map((blocker) => blocker.text);

  return `${total} of ${total} ${podsWord(kind)} carry the agent.${certain.length > 0 ? ` The ${nextWord(kind)} drops it: ${certain.join("; ")}.` : ""}`;
}

interface Indexes {
  namespaces: Map<string, NamespaceLike>;
  pods: Map<string, PodLike[]>;
}

type KindedWorkload = WorkloadLike & { kind: WorkloadKind };

function languageRowsOf(
  workload: KindedWorkload,
  optIns: OptIn[],
  namespace: string,
  namespaceObject: NamespaceLike | undefined,
  inventory: CoverageInventory,
): LanguageRow[] {
  return optIns.map((optIn): LanguageRow => {
    const resolution = resolveInstrumentation(
      optIn.misplaced ?? optIn.value,
      namespace,
      inventory.instrumentations,
    );

    return {
      optIn,
      label: LANGUAGES[optIn.language].label,
      resolution,
      containers: containersFor(workload, optIn.language, namespaceObject),
      operator: languageSetting(inventory.operator, optIn.language),
      verdict: annotationVerdict(
        optIn,
        resolution,
        workload.kind,
        Boolean(inventory.gaveUp?.instrumentations),
      ),
    };
  });
}

function decisiveOf(active: LanguageRow[], languages: LanguageRow[]): LanguageRow | undefined {
  if (active.length === 0) return languages[0];

  return COVERAGE_STATES.flatMap((state) =>
    active.filter((language) => language.verdict?.state === state),
  )[0];
}

function resolvedInstrumentations(active: LanguageRow[]): InstrumentationLike[] {
  return [
    ...new Map(
      active.flatMap((language) =>
        language.resolution.kind === "resolved"
          ? [[keyOf(language.resolution.instrumentation), language.resolution.instrumentation]]
          : [],
      ) as [string, InstrumentationLike][],
    ).values(),
  ];
}

function rowBlockers(
  workload: KindedWorkload,
  namespace: string,
  namespaceObject: NamespaceLike | undefined,
  inventory: CoverageInventory,
  asked: Language[],
  settings: Map<Language, LanguageSetting>,
  resolved: InstrumentationLike[],
): Blocker[] {
  const enabled = asked.filter((language) => settings.get(language)?.kind === "on");

  return [
    ...sidecarBlockers(
      workload,
      namespaceObject,
      inventory.collectors,
      inventory.gaveUp?.collectors,
    ),
    ...containerBlockers(workload, enabled, namespaceObject).map((text) => ({
      certain: true,
      text,
    })),
    // Unless Python is off: a container it cannot set up gets no agent either way.
    ...(asked.includes("python") && settings.get("python")?.kind !== "off"
      ? pythonBlockers(workload, namespaceObject).map((text) => ({
          certain: true,
          hollow: true,
          text,
        }))
      : []),
    ...operatorBlockers(settings),
    ...resolved.flatMap((instrumentation) =>
      tlsBlockers(instrumentation, namespace, inventory.references),
    ),
  ];
}

function stateOf(
  verdict: LanguageRow["verdict"],
  blockers: Blocker[],
  injected: number,
  total: number,
  kind: WorkloadKind,
): CoverageState {
  if (verdict) return verdict.state;
  if (blockers.some((blocker) => blocker.certain && blocker.hollow)) return "blocked";
  if (total > 0 && injected === total) return "injected";
  if (blockers.some((blocker) => blocker.certain)) return "blocked";
  if (blockers.length > 0) {
    return blockers.every((blocker) => blocker.pending) ? "pending" : "unknown";
  }
  if (total === 0 || isBatch(kind)) return "injected";

  return "restart-needed";
}

function rowReason(
  state: CoverageState,
  verdict: LanguageRow["verdict"],
  kind: WorkloadKind,
  counts: { injected: number; total: number },
  blockers: Blocker[],
): string {
  const { injected, total } = counts;
  let reason = verdict ? verdict.reason : reasonFromPods(state, kind, counts, blockers);

  if (state === "opted-out" && injected > 0) {
    reason += isBatch(kind)
      ? ` ${injected} of ${total} ${podsWord(kind)} carry the agent; the next run does not.`
      : ` ${injected} of ${total} pods carry the agent until they restart.`;
  } else if ((state === "no-instrumentation" || state === "ambiguous") && injected > 0) {
    reason += ` The ${nextWord(kind)} drops the agent its pods carry now.`;
  }

  return reason;
}

function rowContainers(pods: PodInjection[], active: LanguageRow[]): CoverageRow["containers"] {
  const fromPods = pods.filter((each) => each.injected).flatMap((each) => each.containers);

  return fromPods.length > 0
    ? { names: [...new Set(fromPods)].sort(), predicted: false }
    : {
        names: [...new Set(active.flatMap((language) => language.containers.names))],
        predicted: true,
      };
}

function rowOf(
  workload: KindedWorkload,
  inventory: CoverageInventory,
  indexes: Indexes,
): CoverageRow | undefined {
  const namespace = String(workload.getNs());
  const namespaceObject = indexes.namespaces.get(namespace);
  const optIns = optInsOf(workload, namespaceObject);
  const asksForAgent = optIns.some((optIn) =>
    [optIn.template, optIn.namespace, optIn.workload].some((value) => value && !isFalse(value)),
  );

  if (!asksForAgent) return undefined;

  const languages = languageRowsOf(workload, optIns, namespace, namespaceObject, inventory);
  const active = languages.filter((language) => language.verdict?.state !== "opted-out");
  const decisive = decisiveOf(active, languages);
  const verdict = decisive?.verdict;
  const resolved = resolvedInstrumentations(active);
  const asked = (active.length > 0 ? active : languages).map((language) => language.optIn.language);
  const run = workload.kind === "CronJob" ? lastJobOf(workload, inventory.workloads) : undefined;
  const pods = podsOf(run ?? workload, indexes.pods.get(namespace) ?? []).map((pod) =>
    injectionOf(pod, asked),
  );
  const injected = pods.filter((each) => each.injected).length;
  const total = pods.length;
  const settings = new Map(
    languages
      .filter((language) => asked.includes(language.optIn.language))
      .map((language): [Language, LanguageSetting] => [language.optIn.language, language.operator]),
  );
  const blockers: Blocker[] = decisive
    ? []
    : rowBlockers(workload, namespace, namespaceObject, inventory, asked, settings, resolved);
  const state = stateOf(verdict, blockers, injected, total, workload.kind);
  const reason = rowReason(state, verdict, workload.kind, { injected, total }, blockers);

  return {
    key: `${workload.kind}/${keyOf(workload)}`,
    workload,
    kind: workload.kind,
    name: workload.getName(),
    namespace,
    languages,
    decisive,
    instrumentation: resolved[0],
    pods,
    ...(run ? { run: run.getName() } : {}),
    injected,
    total,
    containers: rowContainers(pods, active),
    blockers,
    state,
    verdict: { ...COVERAGE_STATUS[state], reason },
  };
}

const worstFirst = (a: CoverageRow, b: CoverageRow) =>
  COVERAGE_STATES.indexOf(a.state) - COVERAGE_STATES.indexOf(b.state) ||
  keyOf(a.workload).localeCompare(keyOf(b.workload)) ||
  a.kind.localeCompare(b.kind);

/** One row per Deployment, StatefulSet, DaemonSet, CronJob or owner-less Job that asks for the agent, worst first. */
export function coverageRows(
  inventory: CoverageInventory,
  only?: ReadonlySet<string>,
): CoverageRow[] {
  const indexes: Indexes = {
    namespaces: new Map(inventory.namespaces.map((each) => [each.getName(), each])),
    pods: byNamespace(inventory.pods),
  };

  return inventory.workloads
    .flatMap((workload) =>
      standsAlone(workload) && (!only || only.has(`${workload.kind}/${keyOf(workload)}`))
        ? (rowOf(workload as KindedWorkload, inventory, indexes) ?? [])
        : [],
    )
    .sort(worstFirst);
}

const awaitsNames = (row: CoverageRow) => row.blockers.some((blocker) => blocker.awaitsNames);

/** With the names read: only the rows a lookup waited on are built again, the rest kept. */
export function withReferences(rows: CoverageRow[], inventory: CoverageInventory): CoverageRow[] {
  const waiting = new Set(rows.filter(awaitsNames).map((row) => row.key));

  if (waiting.size === 0) return rows;

  // Every workload stays in: a CronJob's pods are found through its Jobs.
  const again = new Map(coverageRows(inventory, waiting).map((row) => [row.key, row]));

  return rows.map((row) => again.get(row.key) ?? row).sort(worstFirst);
}

export type CoverageFilter =
  | "all"
  | "attention"
  | "restart-needed"
  | "not-injected"
  | "injected"
  | "opted-out";

export const COVERAGE_FILTERS: readonly CoverageFilter[] = [
  "all",
  "attention",
  "restart-needed",
  "not-injected",
  "injected",
  "opted-out",
];

export const FILTER_LABELS: Record<CoverageFilter, string> = {
  all: "All",
  attention: "Needs attention",
  "restart-needed": "Restart needed",
  "not-injected": "Not injected",
  injected: "Injected",
  "opted-out": "Opted out",
};

export const FILTER_TITLES: Record<CoverageFilter, string> = {
  all: "Shows every workload that opts in or out",
  attention: "Shows the workloads that are not injected or need a restart",
  "restart-needed": "Shows the workloads whose pods started before the agent could be injected",
  "not-injected": "Shows the workloads the operator would admit without the agent",
  injected: "Shows the workloads whose pods all carry the agent",
  "opted-out": "Shows the workloads an annotation opts out",
};

const NOT_INJECTED: readonly CoverageState[] = [
  "no-instrumentation",
  "ambiguous",
  "misplaced",
  "blocked",
  "unknown",
];

export function matchesFilter(row: CoverageRow, filter: CoverageFilter): boolean {
  switch (filter) {
    case "attention":
      return needsAttention(row.verdict);
    case "not-injected":
      return NOT_INJECTED.includes(row.state);
    case "restart-needed":
    case "injected":
    case "opted-out":
      return row.state === filter;
    default:
      return true;
  }
}

/** What the search matches; `namespace/name` tells apart rows of one name. */
export function coverageSearchTexts(row: CoverageRow): string[] {
  return [
    row.name,
    row.namespace,
    `${row.namespace}/${row.name}`,
    row.kind,
    row.instrumentation ? keyOf(row.instrumentation) : "",
    row.verdict.label,
  ];
}

export function filterOf(param: string | undefined): CoverageFilter {
  return COVERAGE_FILTERS.find((filter) => filter === param) ?? "all";
}

/** Ready only once no row waits on a read still under way, so the page says it is still reading. */
export function coverageLoadState(state: LoadState, rows: CoverageRow[]): LoadState {
  return state === "ready" && rows.some((row) => row.state === "pending") ? "connecting" : state;
}

/** The pod namespaces whose Secret and ConfigMap names a TLS blocker still waits for. */
export function lookupNamespaces(rows: CoverageRow[]): string[] {
  const waiting = rows.filter(awaitsNames);

  return [...new Set(waiting.map((row) => row.namespace))].sort();
}

export function tally(rows: CoverageRow[]): Record<CoverageFilter, number> {
  return Object.fromEntries(
    COVERAGE_FILTERS.map((filter) => [
      filter,
      rows.filter((row) => matchesFilter(row, filter)).length,
    ]),
  ) as Record<CoverageFilter, number>;
}
