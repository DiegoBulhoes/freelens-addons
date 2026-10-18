import { type CollectorRow, collectorRows } from "../collectors/collectors";
import type { CollectorLike, EnvName, InstrumentationLike, PodLike } from "../shared/types";
import type { Language } from "./annotations";
import type { CoverageRow } from "./coverage";
import { keyOf } from "./resolve";
import { podTemplateOf } from "./workload-pods";

// Any of these, wherever the agent reads it, wins over spec.exporter.endpoint; values are never read.
const ENDPOINT_VARIABLES: readonly string[] = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
];

// The OTLP receiver's defaults when a protocol sets no endpoint.
const OTLP_DEFAULTS: Record<string, number> = { grpc: 4317, http: 4318 };

export type Exporter =
  | {
      kind: "collector";
      collector: CollectorLike;
      endpoint: string;
      port?: number;
      /** The ports its OTLP receivers listen on; undefined when its config cannot be read. */
      ports?: number[];
      /** Undefined when its namespace is outside the scope, so its pods are not loaded. */
      health?: CollectorRow;
    }
  | { kind: "missing"; namespace: string; name: string; endpoint: string }
  | { kind: "unknown"; why: string };

export function parseEndpoint(endpoint: string): { host: string; port?: number } | undefined {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:?#]+)(?::(\d+))?(?:[/?#].*)?$/i.exec(
    endpoint.trim(),
  );

  if (!match?.[1]) return undefined;

  return { host: match[1].toLowerCase(), port: match[2] ? Number(match[2]) : undefined };
}

/** `<name>-collector[-headless].<namespace>[.svc[.cluster.local]]`, the Services the operator names. */
export function collectorOfHost(
  host: string,
  podNamespace: string,
): { namespace: string; name: string } | undefined {
  const match =
    /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-collector(?:-headless)?(?:\.([a-z0-9-]+)(?:\.svc(?:\.cluster\.local)?)?)?\.?$/.exec(
      host,
    );

  if (!match?.[1]) return undefined;

  return { name: match[1], namespace: match[2] ?? podNamespace };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The ports of every `otlp` receiver's protocols; undefined when the config is not an object. */
export function otlpPorts(config: unknown): number[] | undefined {
  if (!isObject(config)) return undefined;

  const receivers = isObject(config.receivers) ? config.receivers : {};
  const ports = Object.entries(receivers)
    .filter(([name]) => name === "otlp" || name.startsWith("otlp/"))
    .flatMap(([, receiver]) => {
      const protocols =
        isObject(receiver) && isObject(receiver.protocols) ? receiver.protocols : {};

      return Object.entries(protocols).flatMap(([protocol, settings]) => {
        const endpoint = isObject(settings) ? settings.endpoint : undefined;
        const port =
          typeof endpoint === "string"
            ? Number(/:(\d+)$/.exec(endpoint)?.[1])
            : OTLP_DEFAULTS[protocol];

        return port ? [port] : [];
      });
    });

  return [...new Set(ports)].sort((a, b) => a - b);
}

const endpointVariableIn = (env: EnvName[] | undefined) =>
  (env ?? []).map((each) => each.name).find((name) => ENDPOINT_VARIABLES.includes(name));

type LanguageField = "java" | "nodejs" | "python" | "dotnet" | "go" | "apacheHttpd" | "nginx";

// The Instrumentation's own field per language; the SDK has none.
const LANGUAGE_FIELDS: Partial<Record<Language, LanguageField>> = {
  java: "java",
  nodejs: "nodejs",
  python: "python",
  dotnet: "dotnet",
  go: "go",
  "apache-httpd": "apacheHttpd",
  nginx: "nginx",
};

/** Where a variable the agent reads before the Instrumentation's endpoint is set. */
function overrideOf(row: CoverageRow, instrumentation: InstrumentationLike): string | undefined {
  const containers = podTemplateOf(row.workload).spec?.containers ?? [];

  for (const container of containers.filter((each) => row.containers.names.includes(each.name))) {
    const name = endpointVariableIn(container.env);

    if (name) return `${name} on container ${container.name}`;
  }
  for (const language of row.languages) {
    const key = LANGUAGE_FIELDS[language.optIn.language];
    const name = key && endpointVariableIn(instrumentation.spec[key]?.env);

    if (name) return `${name} in spec.${key}.env of ${keyOf(instrumentation)}`;
  }

  const name = endpointVariableIn(instrumentation.spec.env);

  return name ? `${name} in spec.env of ${keyOf(instrumentation)}` : undefined;
}

/** The collector its agent exports to, by the Service name; undefined with no Instrumentation. */
export function resolveExporter(
  row: CoverageRow,
  collectors: CollectorLike[] | undefined,
): Exporter | undefined {
  const instrumentation = row.instrumentation;

  if (!instrumentation) return undefined;

  const override = overrideOf(row, instrumentation);

  if (override) return { kind: "unknown", why: `${override} sets it; its value is not read` };

  const endpoint = instrumentation.spec.exporter?.endpoint;

  if (!endpoint) return { kind: "unknown", why: "no endpoint is set, so the agent's default" };

  const parsed = parseEndpoint(endpoint);
  const target = parsed && collectorOfHost(parsed.host, row.namespace);

  if (!parsed || !target) {
    return { kind: "unknown", why: `${endpoint} is not a collector's Service` };
  }
  if (!collectors) return { kind: "unknown", why: "the collectors are not read yet" };

  const collector = collectors.find(
    (each) => each.getNs() === target.namespace && each.getName() === target.name,
  );

  if (!collector) return { kind: "missing", ...target, endpoint };

  return {
    kind: "collector",
    collector,
    endpoint,
    port: parsed.port,
    ports: otlpPorts(collector.spec.config),
  };
}

/** With the collector's health, when its namespace is in scope and so its pods are loaded. */
export function exporterOf(
  row: CoverageRow,
  inventory: { collectors?: CollectorLike[]; pods: PodLike[]; scope: readonly string[] },
  now: number,
): Exporter | undefined {
  const exporter = resolveExporter(row, inventory.collectors);

  if (exporter?.kind !== "collector") return exporter;
  if (!inventory.scope.includes(String(exporter.collector.getNs()))) return exporter;

  const [health] = collectorRows([exporter.collector], inventory.pods, new Map(), now);

  return { ...exporter, health };
}
