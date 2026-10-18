import {
  INSTANCE_FILTER_TITLES,
  type InstanceFilter,
  type InstanceRow,
  matchesInstanceFilter,
} from "../instances/instances";
import {
  MONITOR_FILTER_TITLES,
  type MonitorFilter,
  type MonitorRow,
  matchesMonitorFilter,
} from "../monitors/monitors";
import {
  matchesRuleFilter,
  RULE_FILTER_TITLES,
  type RuleFilter,
  type RuleRow,
} from "../rules/rules";
import { objectKey } from "../shared/selectors";
import { plural, RANK, type Tone, type Verdict } from "../shared/verdict";

export type Page = "monitors" | "rules" | "instances";

export const PAGE_TITLES: Record<Page, string> = {
  monitors: "Monitors",
  rules: "Rules",
  instances: "Instances",
};

/** The one row a list opens the drawer of; a bare name only narrows the list. */
export interface RowParams {
  kind?: string;
  namespace?: string;
  name?: string;
}

export type OpenPage = (page: Page, params?: RowParams & { filter?: string }) => void;

export interface AttentionItem {
  key: string;
  page: Page;
  opens: { kind: string; namespace: string; name: string };
  name: string;
  meta: string;
  verdict: Verdict;
}

function needingAttention(monitors: MonitorRow[], rules: RuleRow[], instances: InstanceRow[]) {
  return {
    monitors: monitors.filter((row) => matchesMonitorFilter(row, "attention")),
    rules: rules.filter((row) => matchesRuleFilter(row, "attention")),
    instances: instances.filter((row) => matchesInstanceFilter(row, "attention")),
  };
}

const attentionItem = (
  page: Page,
  kind: string,
  row: { key: string; name: string; namespace: string; verdict: Verdict },
): AttentionItem => ({
  key: `${page}/${row.key}`,
  page,
  opens: { kind, namespace: row.namespace, name: row.name },
  name: row.name,
  meta: `${kind} · ${row.namespace}`,
  verdict: row.verdict,
});

/** Worst first; a firing alert is about the workload, so it comes after broken configuration. */
export function attentionOf(
  monitors: MonitorRow[],
  rules: RuleRow[],
  instances: InstanceRow[],
): AttentionItem[] {
  const needing = needingAttention(monitors, rules, instances);

  return [
    ...needing.instances.map((row) => attentionItem("instances", row.kind, row)),
    ...needing.monitors.map((row) => attentionItem("monitors", row.kind, row)),
    ...needing.rules.map((row) => attentionItem("rules", "PrometheusRule", row)),
  ].sort((a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone]);
}

/** The key of the row whose drawer the route params open; undefined unless they name one. */
export function namedKey(named: RowParams): string | undefined {
  if (!named.kind || !named.namespace || !named.name) return undefined;

  return objectKey(named.kind, named.namespace, named.name);
}

export function describeHeadline(
  monitors: MonitorRow[],
  rules: RuleRow[],
  instances: InstanceRow[],
): string {
  const needing = needingAttention(monitors, rules, instances);
  const parts = [
    [needing.monitors.length, monitors.length, "monitor"],
    [needing.rules.length, rules.length, "rule"],
    [needing.instances.length, instances.length, "instance"],
  ] as const;
  const failing = parts.filter(([count]) => count > 0);

  if (failing.length > 0) {
    const one = failing.length === 1 && failing[0]?.[0] === 1;

    return `${failing.map(([count, total, noun]) => `${count} of ${plural(total, noun)}`).join(", ")} need${one ? "s" : ""} attention`;
  }
  if (monitors.length + rules.length + instances.length === 0) {
    return "No monitor, rule or Prometheus in the namespaces shown";
  }

  return `${plural(monitors.length, "monitor")} and ${plural(rules.length, "rule")}, none needing attention`;
}

export interface Card {
  label: string;
  value: number;
  tone?: Tone;
  /** The tooltip: what the list it opens shows. */
  title: string;
  opens:
    | { page: "monitors"; filter: MonitorFilter }
    | { page: "rules"; filter: RuleFilter }
    | { page: "instances"; filter: InstanceFilter };
}

const opensTitle = (chipTitle: string) => chipTitle.replace(/^Shows /, "Opens ");

/** A card counts exactly the rows its list filter keeps. */
export function cardsOf(
  monitors: MonitorRow[],
  rules: RuleRow[],
  instances: InstanceRow[],
): Card[] {
  const monitorCount = (filter: MonitorFilter) =>
    monitors.filter((row) => matchesMonitorFilter(row, filter)).length;
  const ruleCount = (filter: RuleFilter) =>
    rules.filter((row) => matchesRuleFilter(row, filter)).length;
  const monitorCard = (label: string, filter: MonitorFilter, tone?: Tone): Card => ({
    label,
    value: monitorCount(filter),
    tone,
    title: opensTitle(MONITOR_FILTER_TITLES[filter]),
    opens: { page: "monitors", filter },
  });
  const ruleCard = (label: string, filter: RuleFilter, tone?: Tone): Card => ({
    label,
    value: ruleCount(filter),
    tone,
    title: opensTitle(RULE_FILTER_TITLES[filter]),
    opens: { page: "rules", filter },
  });

  return [
    monitorCard("Monitors down", "down", "critical"),
    monitorCard("Monitors with no target", "no-target", "critical"),
    monitorCard("Monitors not selected", "not-selected", "warning"),
    monitorCard("Monitors rejected or not loaded", "rejected", "critical"),
    ruleCard("Rules rejected or failing", "rejected", "critical"),
    ruleCard("Rules firing or pending", "firing", "warning"),
    ruleCard("Rules not loaded", "not-loaded", "warning"),
    {
      label: "Instances needing attention",
      value: needingAttention(monitors, rules, instances).instances.length,
      tone: "critical",
      title: opensTitle(INSTANCE_FILTER_TITLES.attention),
      opens: { page: "instances", filter: "attention" },
    },
  ];
}
