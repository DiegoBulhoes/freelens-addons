import { describeAlerting, type InstanceRow } from "../instances/instances";
import { type MonitorRow, staticTargets, targetNoun } from "../monitors/monitors";
import type { EndpointCheck } from "../monitors/targets";
import { PAGE_TITLES, type Page } from "../overview/attention";
import { loadedBy, type RuleRow } from "../rules/rules";
import { HOST_LIST_TITLES, type HostKind } from "./host-links";
import { describeSource, type Source } from "./selection";
import { describeSelector } from "./selectors";
import { ago, plural } from "./verdict";

/** One of our lists on the object's drawer, or the host's list narrowed to a name. */
export type LinkTarget =
  | { page: Page; kind: string; namespace: string; name: string }
  | { host: HostKind; name: string };

export interface FactPart {
  text: string;
  to?: LinkTarget;
}

export interface Fact {
  term: string;
  value: string;
  /** `value` as parts joined by commas, the related objects linked; drawn instead of it. */
  parts?: FactPart[];
}

export function linkTitle(to: LinkTarget): string {
  return "page" in to
    ? `Opens ${to.name} in the ${PAGE_TITLES[to.page]} list`
    : `Opens the ${HOST_LIST_TITLES[to.host]} list narrowed to ${to.name}`;
}

/** A namespace/name, or a namespace/name:port, linked to the host's list by its name. */
export function hostPart(host: HostKind, key: string): FactPart {
  return { text: key, to: { host, name: key.slice(key.indexOf("/") + 1).replace(/:.*$/, "") } };
}

const sourceNames = (sources: Source[]) =>
  sources.length > 0 ? sources.map(describeSource).join(", ") : "Nobody";

// The collector behind a TargetAllocator has no list here, so it stays text.
const sourcesFact = (term: string, sources: Source[]): Fact => ({
  term,
  value: sourceNames(sources),
  ...(sources.length > 0 && {
    parts: sources.map((source) => ({
      text: describeSource(source),
      ...(source.kind !== "TargetAllocator" && {
        to: {
          page: "instances" as const,
          kind: source.kind,
          namespace: source.namespace,
          name: source.name,
        },
      }),
    })),
  }),
});

const hostsFact = (term: string, host: HostKind, keys: string[], none: string): Fact => ({
  term,
  value: keys.join(", ") || none,
  ...(keys.length > 0 && { parts: keys.map((key) => hostPart(host, key)) }),
});

/** The Selected by cell: who, shortest first, as namespace/name. */
export function shortSourceNames(sources: Source[]): string {
  if (sources.length === 0) return "Nobody";

  return sources
    .map((source) =>
      source.kind === "TargetAllocator"
        ? `TA ${source.namespace}/${source.name}`
        : `${source.namespace}/${source.name}`,
    )
    .join(", ");
}

/** The Target cell: what the Kubernetes checks found, worst endpoint first. */
export function describeTarget(row: MonitorRow): string {
  if (row.kind === "ScrapeConfig") {
    const count = staticTargets(row.monitor).length;

    return count > 0 ? plural(count, "static target") : "Its own discovery";
  }

  const [worst] = [...row.checks].sort((a, b) => a.addresses - b.addresses);

  if (!worst) return "No endpoint";

  return [
    plural(worst.targets.length, targetNoun(row.kind)),
    ...(worst.port ? [`port ${worst.port}`] : []),
    plural(worst.addresses, "endpoint"),
    `${worst.ready} ready`,
  ].join(" · ");
}

/** The Live cell; unknown when no Prometheus that selects it was read. */
export function describeLive(row: MonitorRow): string {
  const { health } = row;

  if (!health) return "Unknown";

  return [
    `${health.up} up`,
    ...(health.down > 0 ? [`${health.down} down`] : []),
    ...(health.unknown > 0 ? [`${health.unknown} pending`] : []),
  ].join(" · ");
}

export function monitorFacts(row: MonitorRow): Fact[] {
  const namespaces = row.looksIn;

  return [
    { term: "Kind", value: row.kind },
    sourcesFact("Selected by", row.selection.selectedBy),
    ...(row.selection.excludedBy.length > 0
      ? [sourcesFact("Labels match, namespace not", row.selection.excludedBy)]
      : []),
    ...(row.kind === "ScrapeConfig"
      ? [
          {
            term: "Static targets",
            value: staticTargets(row.monitor).join(", ") || "None",
          },
        ]
      : [
          { term: "Selector", value: describeSelector(row.monitor.spec.selector) },
          {
            term: "Looks in",
            value: namespaces.any ? "Every namespace" : namespaces.names.join(", "),
          },
        ]),
    { term: "Live", value: describeHealth(row) },
  ];
}

function describeHealth(row: MonitorRow): string {
  const { health } = row;

  if (!health) return "Unknown: no Prometheus that selects it was read";

  return [
    `${health.up} up`,
    `${health.down} down`,
    ...(health.unknown > 0 ? [`${health.unknown} not scraped yet`] : []),
  ].join(", ");
}

const CHECKS: Record<EndpointCheck["state"], string> = {
  ok: "Has endpoints",
  "no-target": "Nothing matches",
  "port-missing": "Port not found",
  "no-endpoints": "No endpoint",
  unchecked: "Not checked: no port name",
};

/** `matches`: what the selector matches, a ServiceMonitor's Services or a PodMonitor's pods. */
export function endpointFacts(check: EndpointCheck, matches: HostKind): Fact[] {
  return [
    { term: "Port", value: check.port ?? "—" },
    hostsFact("Matched", matches, check.targets, "Nothing"),
    hostsFact("With the port", matches, check.withPort, "None"),
    { term: "Endpoints", value: String(check.addresses) },
    { term: "Ready", value: String(check.ready) },
    { term: "Check", value: CHECKS[check.state] },
  ];
}

export function ruleFacts(row: RuleRow, now: number): Fact[] {
  const [oldest] = [...row.firing].sort((a, b) =>
    String(a.activeAt).localeCompare(String(b.activeAt)),
  );

  return [
    sourcesFact("Loaded by", loadedBy(row)),
    sourcesFact("Selected by", row.selection.selectedBy),
    { term: "Groups", value: String(row.groups) },
    {
      term: "Rules",
      value: `${plural(row.alerting, "alerting rule")}, ${plural(row.recording, "recording rule")}`,
    },
    {
      term: "Firing",
      value:
        row.firing.length > 0
          ? `${row.firing.length}, since ${ago(oldest?.activeAt, now)}`
          : "None",
    },
  ];
}

export function instanceFacts(row: InstanceRow): Fact[] {
  const alerting = describeAlerting(row);

  return [
    { term: "Kind", value: row.kind },
    { term: "Ready", value: `${row.ready} of ${row.desired}` },
    ...(row.kind === "Alertmanager" ? [] : [{ term: "Shards", value: String(row.shards) }]),
    { term: "Available", value: describeCondition(row.available) },
    { term: "Reconciled", value: describeCondition(row.reconciled) },
    ...row.selects.map((line) => {
      const [term = "", value = ""] = line.split(": ");

      return { term, value };
    }),
    // Each entry names the Service its Alertmanagers are found behind.
    ...(row.kind === "Prometheus"
      ? [hostsFact("Alertmanagers", "Service", row.alertmanagers, "None")]
      : []),
    ...(alerting ? [{ term: "Sends alerts to", value: alerting }] : []),
  ];
}

function describeCondition(condition: InstanceRow["available"]): string {
  if (!condition) return "Not reported";

  const why = condition.message || condition.reason;

  return why ? `${condition.status}: ${why}` : condition.status;
}
