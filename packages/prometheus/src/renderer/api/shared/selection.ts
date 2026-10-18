import { currentRejection, type Rejection } from "./rejections";
import {
  allowedByLists,
  matchesSelector,
  namespaceMatches,
  namespaceOf,
  objectKey,
} from "./selectors";
import type {
  Binding,
  CollectorLike,
  LabelSelector,
  Labels,
  MonitorKind,
  Named,
  NamespaceLike,
  PrometheusLike,
  PrometheusSpec,
  RuleLike,
} from "./types";

export type SourceKind = "Prometheus" | "PrometheusAgent" | "TargetAllocator";

export interface KindSelectors {
  selector: LabelSelector | null | undefined;
  namespaceSelector: LabelSelector | null | undefined;
}

/** Something that selects monitors: a Prometheus, a PrometheusAgent or a collector's TargetAllocator. */
export interface Source {
  key: string;
  kind: SourceKind;
  namespace: string;
  name: string;
  paused: boolean;
  selectors: Record<MonitorKind, KindSelectors>;
  /** Only a Prometheus evaluates rules. */
  rules?: KindSelectors;
  allow?: string[];
  deny?: string[];
  ignoreNamespaceSelectors: boolean;
}

function selectorsOf(spec: PrometheusSpec): Record<MonitorKind, KindSelectors> {
  return {
    ServiceMonitor: {
      selector: spec.serviceMonitorSelector,
      namespaceSelector: spec.serviceMonitorNamespaceSelector,
    },
    PodMonitor: {
      selector: spec.podMonitorSelector,
      namespaceSelector: spec.podMonitorNamespaceSelector,
    },
    ScrapeConfig: {
      selector: spec.scrapeConfigSelector,
      namespaceSelector: spec.scrapeConfigNamespaceSelector,
    },
  };
}

function prometheusSource(object: PrometheusLike, kind: SourceKind): Source {
  const namespace = namespaceOf(object);

  return {
    key: objectKey(kind, namespace, object.getName()),
    kind,
    namespace,
    name: object.getName(),
    paused: Boolean(object.spec.paused),
    selectors: selectorsOf(object.spec),
    rules:
      kind === "Prometheus"
        ? {
            selector: object.spec.ruleSelector,
            namespaceSelector: object.spec.ruleNamespaceSelector,
          }
        : undefined,
    ignoreNamespaceSelectors: Boolean(object.spec.ignoreNamespaceSelectors),
  };
}

// The CRD defaults a TargetAllocator's namespace selectors to {}: every namespace.
const allNamespacesUnlessSet = (selector: LabelSelector | null | undefined) => selector ?? {};

function allocatorSource(collector: CollectorLike): Source | undefined {
  const allocator = collector.spec.targetAllocator;
  const cr = allocator?.prometheusCR;

  if (!allocator?.enabled || !cr?.enabled) return undefined;

  const namespace = namespaceOf(collector);

  return {
    key: objectKey("TargetAllocator", namespace, collector.getName()),
    kind: "TargetAllocator",
    namespace,
    name: collector.getName(),
    paused: false,
    selectors: {
      ServiceMonitor: {
        selector: cr.serviceMonitorSelector,
        namespaceSelector: allNamespacesUnlessSet(cr.serviceMonitorNamespaceSelector),
      },
      PodMonitor: {
        selector: cr.podMonitorSelector,
        namespaceSelector: allNamespacesUnlessSet(cr.podMonitorNamespaceSelector),
      },
      ScrapeConfig: {
        selector: cr.scrapeConfigSelector,
        namespaceSelector: allNamespacesUnlessSet(cr.scrapeConfigNamespaceSelector),
      },
    },
    allow: cr.allowNamespaces,
    deny: cr.denyNamespaces,
    ignoreNamespaceSelectors: false,
  };
}

export function selectorSources(
  prometheuses: PrometheusLike[],
  agents: PrometheusLike[],
  collectors: CollectorLike[],
): Source[] {
  return [
    ...prometheuses.map((each) => prometheusSource(each, "Prometheus")),
    ...agents.map((each) => prometheusSource(each, "PrometheusAgent")),
    ...collectors.flatMap((each) => allocatorSource(each) ?? []),
  ];
}

export function namespaceLabelsOf(namespaces: NamespaceLike[]): Map<string, Labels> {
  return new Map(namespaces.map((each) => [each.getName(), each.metadata.labels ?? {}]));
}

export interface BindingState {
  key: string;
  accepted: boolean | undefined;
  reason?: string;
  message?: string;
}

const RESOURCE_KINDS: Record<string, SourceKind> = {
  prometheuses: "Prometheus",
  prometheusagents: "PrometheusAgent",
};

/** status.bindings, written only when the operator's StatusForConfigurationResources gate is on. */
export function bindingsOf(object: { status?: { bindings?: Binding[] } }): BindingState[] {
  return (object.status?.bindings ?? []).flatMap((binding) => {
    const kind = RESOURCE_KINDS[binding.resource ?? ""];

    if (!kind || !binding.name) return [];

    const accepted = binding.conditions?.find((condition) => condition.type === "Accepted");

    return [
      {
        key: objectKey(kind, binding.namespace, binding.name),
        accepted: accepted ? accepted.status === "True" : undefined,
        reason: accepted?.reason,
        message: accepted?.message,
      },
    ];
  });
}

export interface Selection {
  /** Sources whose selectors take it, or whose binding accepted it. */
  selectedBy: Source[];
  /** Sources whose label selector takes it but whose namespace selector or lists leave it out. */
  excludedBy: Source[];
  /** Sources that selected it and refused it, from a binding. */
  refusedBy: { source: Source; message: string }[];
}

type Selectable = Named & { status?: { bindings?: Binding[] } };

function selectionWith(
  object: Selectable,
  sources: Source[],
  selectorsFor: (source: Source) => KindSelectors | undefined,
  namespaceLabels: Map<string, Labels>,
): Selection {
  const namespace = namespaceOf(object);
  const bindings = new Map(bindingsOf(object).map((binding) => [binding.key, binding]));
  const selection: Selection = { selectedBy: [], excludedBy: [], refusedBy: [] };

  for (const source of sources) {
    const selectors = selectorsFor(source);
    const binding = bindings.get(source.key);

    if (binding?.accepted !== undefined) {
      selection.selectedBy.push(source);
      if (!binding.accepted) {
        selection.refusedBy.push({
          source,
          message: binding.message || binding.reason || "Not accepted",
        });
      }
      continue;
    }

    if (!selectors || !matchesSelector(selectors.selector, object.metadata.labels)) continue;

    const inNamespace =
      allowedByLists(namespace, source.allow, source.deny) &&
      namespaceMatches(
        selectors.namespaceSelector,
        namespace,
        source.namespace,
        namespaceLabels.get(namespace),
      );

    (inNamespace ? selection.selectedBy : selection.excludedBy).push(source);
  }

  return selection;
}

export function monitorSelection(
  monitor: Selectable,
  kind: MonitorKind,
  sources: Source[],
  namespaceLabels: Map<string, Labels>,
): Selection {
  return selectionWith(monitor, sources, (source) => source.selectors[kind], namespaceLabels);
}

export function ruleSelection(
  rule: RuleLike,
  sources: Source[],
  namespaceLabels: Map<string, Labels>,
): Selection {
  return selectionWith(rule, sources, (source) => source.rules, namespaceLabels);
}

export function describeSource(source: Source): string {
  const kind = source.kind === "TargetAllocator" ? "TargetAllocator of" : source.kind;

  return `${kind} ${source.namespace}/${source.name}`;
}

type SelectionState = "rejected" | "namespace-excluded" | "not-selected";

/** Runs before anything is read. */
export function selectionDecision(
  row: { rejection?: string; selection: Selection; namespace: string },
  notSelectedReason: string,
): { state: SelectionState; reason: string } | undefined {
  if (row.rejection) return { state: "rejected", reason: row.rejection };

  if (row.selection.selectedBy.length > 0) return undefined;

  const [excluder] = row.selection.excludedBy;

  return excluder
    ? {
        state: "namespace-excluded",
        reason: `${describeSource(excluder)} selects its labels, but not namespace ${row.namespace}`,
      }
    : { state: "not-selected", reason: notSelectedReason };
}

export function rejectionOf(
  rejection: Rejection | undefined,
  uid: string | undefined,
  loaded: boolean,
  selection: Selection,
): string | undefined {
  const refused = selection.refusedBy[0];

  return (
    currentRejection(rejection, uid, loaded) ??
    (refused ? `${describeSource(refused.source)}: ${refused.message}` : undefined)
  );
}

export function unreadError(
  source: Source,
  read: { error?: string } | undefined,
): string | undefined {
  if (source.paused) return `${describeSource(source)} is paused`;
  if (!read) return `${describeSource(source)} has not been read`;

  return read.error;
}
