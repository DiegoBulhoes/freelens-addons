import { type CollectorRow, isReady } from "../collectors/collectors";
import type { InstrumentationLike } from "../shared/types";
import type { CoverageRow, LanguageRow } from "./coverage";
import type { Exporter } from "./exporter";
import type { LanguageSetting } from "./operator";
import { keyOf, type Resolution } from "./resolve";

export interface Fact {
  term: string;
  value: string;
}

export function describeResolution(resolution: Resolution): string {
  switch (resolution.kind) {
    case "resolved":
      return `${keyOf(resolution.instrumentation)}, ${resolution.by === "name" ? "by name" : "the only one in its namespace"}`;
    case "missing":
      return resolution.name
        ? `Nothing: ${resolution.namespace}/${resolution.name} does not exist`
        : `Nothing: no Instrumentation in ${resolution.namespace}`;
    case "unread":
      return `Not known: the Instrumentations for ${resolution.namespace} are not read`;
    case "ambiguous":
      return `Nothing: ${resolution.candidates.length} candidates in ${resolution.namespace} (${resolution.candidates.join(", ")})`;
    default:
      return "Nothing: it opts out";
  }
}

function optedInBy({ optIn }: LanguageRow, row: CoverageRow): string {
  if (optIn.misplaced) return `The ${row.kind}'s own annotations, which the operator never reads`;

  return optIn.from === "Namespace" ? `Namespace ${row.namespace}` : "The pod template";
}

function valuesOf({ optIn }: LanguageRow, row: CoverageRow): string {
  const set = [
    optIn.template ? `"${optIn.template}" on the pod template` : undefined,
    optIn.namespace ? `"${optIn.namespace}" on the Namespace` : undefined,
    optIn.workload ? `"${optIn.workload}" on the ${row.kind}` : undefined,
  ].filter(Boolean);

  return `${optIn.key}: ${set.join(", ")}`;
}

const SETTING_LABELS: Record<LanguageSetting["kind"], string> = {
  on: "Injects it",
  off: "Does not inject it",
  unknown: "Unknown",
  pending: "Checking",
};

/** Where a language's opt-in comes from, the values set, what they resolve to, and the operator's switch. */
export function languageFacts(row: CoverageRow, language: LanguageRow): Fact[] {
  return [
    { term: "Language", value: language.label },
    { term: "Opted in by", value: optedInBy(language, row) },
    { term: "Annotation", value: valuesOf(language, row) },
    { term: "Resolves to", value: describeResolution(language.resolution) },
    {
      term: "Operator",
      value: `${SETTING_LABELS[language.operator.kind]}: ${language.operator.why}`,
    },
  ];
}

/** The containers the agent is in, or the ones the webhook would pick and why. */
export function describeContainers(row: CoverageRow): string {
  const { names, predicted } = row.containers;

  if (names.length === 0) return "None: the pod template has no container";
  if (!predicted) return names.join(", ");

  const named = row.languages.some((language) => language.containers.source === "annotation");

  return `Would be ${names.join(", ")}, ${named ? "named by a container-names annotation" : "its first container"}`;
}

export function instrumentationFacts(instrumentation: InstrumentationLike): Fact[] {
  const { exporter, sampler, propagators } = instrumentation.spec;

  return [
    { term: "Endpoint", value: exporter?.endpoint ?? "Not set: the agent's default" },
    {
      term: "Sampler",
      value: sampler?.type
        ? `${sampler.type}${sampler.argument ? ` (${sampler.argument})` : ""}`
        : "Not set: the agent's default",
    },
    { term: "Propagators", value: propagators?.join(", ") || "Not set: the agent's default" },
  ];
}

const dropped = "the agent's telemetry is dropped";

/** The collector drawer the "Exports to" fact opens; undefined unless it names an existing one. */
export function exporterLink(
  exporter: Exporter,
): { namespace: string; name: string; title: string } | undefined {
  if (exporter.kind !== "collector") return undefined;

  const namespace = exporter.collector.getNs() ?? "";
  const name = exporter.collector.getName();

  return { namespace, name, title: `Opens ${namespace}/${name} in the Collectors list` };
}

/** Where the agent's telemetry goes, and a warning when nothing there takes it. */
export function describeExporter(exporter: Exporter): { value: string; warning?: string } {
  if (exporter.kind === "unknown") return { value: `Not known: ${exporter.why}` };
  if (exporter.kind === "missing") {
    const key = `${exporter.namespace}/${exporter.name}`;

    return {
      value: `Nothing: no collector ${key}`,
      warning: `No OpenTelemetryCollector ${key} exists, so ${dropped}.`,
    };
  }

  const key = keyOf(exporter.collector);
  const { ports, port, health } = exporter;

  if (exporter.collector.spec.mode === "sidecar") {
    return {
      value: `${key}, a sidecar, which has no Service`,
      warning: `${key} runs as a sidecar with no Service, so ${dropped}.`,
    };
  }
  if (ports?.length === 0) {
    return {
      value: `${key}, which has no OTLP receiver`,
      warning: `${key} has no OTLP receiver, so ${dropped}.`,
    };
  }
  if (ports && port !== undefined && !ports.includes(port)) {
    return {
      value: `${key}, which takes OTLP on ${ports.join(", ")}, not ${port}`,
      warning: `${key} takes no OTLP on port ${port}, so ${dropped}.`,
    };
  }
  if (!health) return { value: `${key}; its pods are outside the namespaces in scope` };

  const value = `${key}, ${health.verdict.label}`;
  const receiving = health.crashes.length === 0 && health.pods.some(isReady);

  return receiving
    ? { value }
    : { value, warning: `${key} reads ${health.verdict.label}, so ${dropped} until it runs.` };
}

const onOff = (on: boolean) => (on ? "On" : "Off");

export function collectorFacts(row: CollectorRow): Fact[] {
  const { spec, status } = row.collector;
  const reported = status?.scale?.statusReplicas;

  return [
    { term: "Mode", value: row.mode },
    {
      term: "Pods",
      value: row.replicas
        ? `${row.replicas.ready} of ${row.replicas.desired} ready${reported ? `; the operator reports ${reported}` : ""}`
        : `${row.pods.length} carrying it as a sidecar`,
    },
    { term: "Version", value: row.version ?? "—" },
    { term: "Image", value: row.image ?? spec.image ?? "—" },
    { term: "Management", value: row.managementState },
    { term: "Upgrade strategy", value: spec.upgradeStrategy ?? "automatic" },
    { term: "Target allocator", value: onOff(row.targetAllocator) },
    {
      term: "Metrics",
      value: `enableMetrics: ${onOff(row.metrics.serviceMonitor)}, prometheusCR: ${onOff(row.metrics.prometheusCR)}`,
    },
  ];
}
