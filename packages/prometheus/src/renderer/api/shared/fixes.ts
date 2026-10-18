import { type MonitorRow, targetNoun } from "../monitors/monitors";
import type { RuleRow } from "../rules/rules";
import type { Command } from "./commands";
import { REJECTED_REASON } from "./rejections";
import { describeSource, type KindSelectors, type Source } from "./selection";
import { allowedByLists, describeSelector, namespaceMatches } from "./selectors";
import type { LabelSelector, Labels } from "./types";

// Quoted when YAML would read it as anything but a string.
export function yamlScalar(value: string): string {
  const plain =
    /^[A-Za-z0-9_./-][A-Za-z0-9_./ -]*$/.test(value) &&
    !/^(true|false|yes|no|on|off|y|n|null|~|[-+]?[0-9.]+(e[-+]?[0-9]+)?|0x[0-9a-f]+)$/i.test(
      value,
    ) &&
    !value.endsWith(" ");

  return plain ? value : JSON.stringify(value);
}

function labelsBlock(labels: Record<string, string>, indent: string): string[] {
  return Object.entries(labels).map(([key, value]) => `${indent}${key}: ${yamlScalar(value)}`);
}

/** Labels that satisfy a selector's matchLabels; expressions can only be listed as a comment. */
function labelsFor(selector: LabelSelector): string[] {
  const lines = labelsBlock(selector.matchLabels ?? {}, "    ");

  if (selector.matchExpressions?.length) {
    lines.push(
      `    # and also: ${describeSelector({ matchExpressions: selector.matchExpressions })}`,
    );
  }

  return lines;
}

function selectorLabelsYaml(
  source: Source,
  selectors: KindSelectors | undefined,
  kind: string,
): string {
  if (!selectors?.selector) {
    return `# ${describeSource(source)} selects no ${kind}: its selector is not set.`;
  }

  const labels = labelsFor(selectors.selector);

  return [
    `# Labels that ${describeSource(source)} selects on.`,
    "metadata:",
    "  labels:",
    ...(labels.length > 0 ? labels : ["    # its selector is {}: any label will do"]),
  ].join("\n");
}

function namespaceYaml(
  source: Source,
  selectors: KindSelectors | undefined,
  namespace: string,
): string {
  if (!selectors?.namespaceSelector) {
    return `# ${describeSource(source)} reads only its own namespace, ${source.namespace}: move it there.`;
  }

  return [
    `# Labels that ${describeSource(source)} selects namespaces on.`,
    "apiVersion: v1",
    "kind: Namespace",
    "metadata:",
    `  name: ${yamlScalar(namespace)}`,
    "  labels:",
    ...labelsFor(selectors.namespaceSelector),
  ].join("\n");
}

/** Sources a not-selected row could join: a selector is set and its namespace is taken. */
export function candidateSources(
  row: MonitorRow | RuleRow,
  sources: Source[],
  namespaceLabels: Map<string, Labels>,
): Source[] {
  return sources.filter((source) => {
    const selectors = "kind" in row ? source.selectors[row.kind] : source.rules;

    return (
      Boolean(selectors?.selector) &&
      allowedByLists(row.namespace, source.allow, source.deny) &&
      namespaceMatches(
        selectors?.namespaceSelector,
        row.namespace,
        source.namespace,
        namespaceLabels.get(row.namespace),
      )
    );
  });
}

function selectionYaml(
  row: MonitorRow | RuleRow,
  source: Source | undefined,
  selectorsFor: (source: Source) => KindSelectors | undefined,
  kindPlural: string,
): string | undefined {
  if (row.state === "not-selected") {
    return source ? selectorLabelsYaml(source, selectorsFor(source), kindPlural) : undefined;
  }
  if (row.state === "namespace-excluded") {
    const excluder = source ?? row.selection.excludedBy[0];

    return excluder && namespaceYaml(excluder, selectorsFor(excluder), row.namespace);
  }

  return undefined;
}

/** The YAML to copy for a monitor; undefined when there is nothing to change. It is never applied. */
export function monitorFixYaml(row: MonitorRow, source?: Source): string | undefined {
  switch (row.state) {
    case "port-missing":
      return portYaml(row);
    case "no-target":
      return targetYaml(row);
    default:
      return selectionYaml(row, source, (each) => each.selectors[row.kind], `${row.kind}s`);
  }
}

// Only plain settings are copied; credentials, TLS and relabelings stay in the manifest.
const ENDPOINT_FIELDS = [
  "port",
  "portNumber",
  "targetPort",
  "path",
  "scheme",
  "interval",
  "scrapeTimeout",
] as const;

const scalarOf = (value: unknown) =>
  typeof value === "string" ? yamlScalar(value) : String(value);

function endpointYaml(endpoint: Record<string, unknown>, port?: string): string[] {
  const skip: string[] = port === undefined ? [] : ["port", "portNumber"];
  const fields = ENDPOINT_FIELDS.filter(
    (field) => endpoint[field] !== undefined && !skip.includes(field),
  ).map((field) => `${field}: ${scalarOf(endpoint[field])}`);
  const lines = [...(port === undefined ? [] : [port]), ...fields];
  const others = Object.keys(endpoint).some(
    (key) => !(ENDPOINT_FIELDS as readonly string[]).includes(key),
  );

  if (lines.length === 0) return ["    - {} # keep its fields as they are"];

  return [
    ...lines.map((line, index) => `${index === 0 ? "    - " : "      "}${line}`),
    ...(others ? ["      # keep its other fields as they are"] : []),
  ];
}

/** The whole list, so merging it keeps every endpoint; only a failing port changes. */
function portYaml(row: MonitorRow): string | undefined {
  const failing = new Map(
    row.checks.filter((each) => each.state === "port-missing").map((each) => [each.index, each]),
  );

  if (failing.size === 0) return undefined;

  const pod = row.kind === "PodMonitor";
  const list = pod ? "podMetricsEndpoints" : "endpoints";
  const endpoints = ((pod ? row.monitor.spec.podMetricsEndpoints : row.monitor.spec.endpoints) ??
    []) as unknown as Record<string, unknown>[];

  return [
    "spec:",
    `  ${list}:`,
    ...endpoints.flatMap((endpoint, index) => {
      const check = failing.get(index);

      if (!check) return endpointYaml(endpoint);

      const [only, ...more] = check.portNames;
      const was =
        endpoint.port !== undefined
          ? scalarOf(endpoint.port)
          : `portNumber ${scalarOf(endpoint.portNumber)}`;
      const choice =
        check.portNames.length === 0
          ? "; the target names no port"
          : more.length > 0
            ? `; one of: ${check.portNames.join(", ")}`
            : "";
      const name = only !== undefined && more.length === 0 ? yamlScalar(only) : "<port name>";

      return endpointYaml(endpoint, `port: ${name} # was: ${was}${choice}`);
    }),
  ].join("\n");
}

function targetYaml(row: MonitorRow): string | undefined {
  const selector = row.monitor.spec.selector;

  if (!selector || row.kind === "ScrapeConfig") return undefined;

  return [
    `# Labels a ${targetNoun(row.kind)} needs for ${row.name} to select it.`,
    "metadata:",
    "  labels:",
    ...labelsFor(selector),
  ].join("\n");
}

export function ruleFixYaml(row: RuleRow, source?: Source): string | undefined {
  return selectionYaml(row, source, (each) => each.rules, "PrometheusRules");
}

export interface Fix {
  key: string;
  label: string;
  yaml: string;
}

export const fixTitle = (fix: Fix) => `Copy fix YAML: ${fix.label}`;

export const fixTooltip = (fix: Fix) =>
  `Copies the YAML for: ${fix.label}. Commit it to Git; changes nothing in the cluster`;

const fixOf = (key: string, label: string, yaml: string | undefined): Fix[] =>
  yaml ? [{ key, label, yaml }] : [];

function selectionFixes(
  row: MonitorRow | RuleRow,
  sources: Source[],
  namespaceLabels: Map<string, Labels>,
  yamlOf: (source: Source) => string | undefined,
): Fix[] {
  if (row.state === "not-selected") {
    return candidateSources(row, sources, namespaceLabels).flatMap((source) =>
      fixOf(source.key, `Labels to join ${describeSource(source)}`, yamlOf(source)),
    );
  }
  if (row.state === "namespace-excluded") {
    return row.selection.excludedBy.flatMap((source) =>
      fixOf(source.key, `Namespace labels ${describeSource(source)} selects`, yamlOf(source)),
    );
  }

  return [];
}

/** Every fix to copy for a monitor: one per source it could join, or the one change it needs. */
export function monitorFixes(
  row: MonitorRow,
  sources: Source[],
  namespaceLabels: Map<string, Labels>,
): Fix[] {
  switch (row.state) {
    case "port-missing":
      return fixOf(row.state, "The port to scrape", monitorFixYaml(row));
    case "no-target":
      return fixOf(row.state, `Labels a ${targetNoun(row.kind)} needs`, monitorFixYaml(row));
    default:
      return selectionFixes(row, sources, namespaceLabels, (source) => monitorFixYaml(row, source));
  }
}

export function ruleFixes(
  row: RuleRow,
  sources: Source[],
  namespaceLabels: Map<string, Labels>,
): Fix[] {
  return selectionFixes(row, sources, namespaceLabels, (source) => ruleFixYaml(row, source));
}

/** kubectl lines to look further; read-only. */
export function commandsFor(row: {
  kind?: string;
  name: string;
  namespace: string;
  state?: string;
}): Command[] {
  // A rule row carries no kind.
  const resource = (row.kind ?? "PrometheusRule").toLowerCase();
  const target = `-n ${row.namespace} ${resource} ${row.name}`;

  return [
    { label: "Its YAML", command: `kubectl get ${target} -o yaml` },
    { label: "Its description and Events", command: `kubectl describe ${target}` },
    ...(row.state === "rejected" || row.state === "not-loaded"
      ? [
          {
            label: "Why the operator refused it",
            command: `kubectl get events -n ${row.namespace} --field-selector involvedObject.name=${row.name},reason=${REJECTED_REASON}`,
          },
        ]
      : []),
  ];
}
