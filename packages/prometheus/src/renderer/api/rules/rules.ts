import type { PrometheusRead } from "../monitors/scrape-pools";
import type { Rejection } from "../shared/rejections";
import {
  describeSource,
  namespaceLabelsOf,
  rejectionOf,
  ruleSelection,
  type Selection,
  type Source,
  selectionDecision,
  unreadError,
} from "../shared/selection";
import { namespaceOf, objectKey } from "../shared/selectors";
import type { Alert, NamespaceLike, RuleGroup, RuleLike } from "../shared/types";
import { plural, RULE_LOOK, type RuleState, type Verdict } from "../shared/verdict";

const RULE_FILE =
  /\/prometheus-(?<prometheus>.+)-rulefiles-\d+\/.*-(?<uid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.yaml$/;

// The file is <ns>-<rule>-<uid>.yaml and names hold hyphens, so the uid identifies the rule.
export function ruleFileOwner(file: string): { prometheus: string; uid: string } | undefined {
  return RULE_FILE.exec(file)?.groups as { prometheus: string; uid: string } | undefined;
}

// A read is replaced, never changed, when its Prometheus answers again, so its files are parsed once.
const groupsByUid = new WeakMap<RuleGroup[], Map<string, RuleGroup[]>>();

/** A read's loaded groups, by the uid of the PrometheusRule whose file holds them. */
export function groupsOfRules(groups: RuleGroup[]): Map<string, RuleGroup[]> {
  const known = groupsByUid.get(groups);

  if (known) return known;

  const byUid = new Map<string, RuleGroup[]>();

  for (const group of groups) {
    const uid = ruleFileOwner(group.file)?.uid;

    if (uid) byUid.set(uid, [...(byUid.get(uid) ?? []), group]);
  }

  groupsByUid.set(groups, byUid);

  return byUid;
}

export interface RuleInventory {
  rules: RuleLike[];
  namespaces: NamespaceLike[];
  sources: Source[];
  rejections: Map<string, Rejection>;
  reads: PrometheusRead[];
}

export interface RuleLiveView {
  source: Source;
  /** The groups loaded from this rule; undefined when the Prometheus could not be read. */
  groups?: RuleGroup[];
  error?: string;
}

export interface RuleRow {
  key: string;
  name: string;
  namespace: string;
  rule: RuleLike;
  selection: Selection;
  rejection?: string;
  live: RuleLiveView[];
  groups: number;
  alerting: number;
  recording: number;
  firing: Alert[];
  pending: Alert[];
  unhealthy: { name: string; lastError: string }[];
  state: RuleState;
  verdict: Verdict;
}

function liveViewOf(
  source: Source,
  uid: string | undefined,
  reads: Map<string, PrometheusRead>,
): RuleLiveView {
  const read = reads.get(source.key);
  const unread = unreadError(source, read);

  if (unread) return { source, error: unread };
  if (!read?.groups) return { source, error: "Its rules were not read" };

  return { source, groups: uid ? (groupsOfRules(read.groups).get(uid) ?? []) : [] };
}

type Decision = { state: RuleState; reason: string };

function decide(row: Omit<RuleRow, "state" | "verdict">): Decision {
  const unselected = selectionDecision(row, "No Prometheus selects its labels");

  if (unselected) return unselected;

  const read = row.live.filter((view) => view.groups);

  if (read.length === 0) {
    return { state: "unknown", reason: row.live.map((view) => view.error).join("; ") };
  }
  if (read.every((view) => view.groups?.length === 0)) {
    return {
      state: "not-loaded",
      reason: `${read.map((view) => describeSource(view.source)).join(", ")} has not loaded it; its Events or logs say why`,
    };
  }
  if (row.unhealthy.length > 0) {
    const [first] = row.unhealthy;

    return {
      state: "unhealthy",
      reason: `${plural(row.unhealthy.length, "rule")} failing${first?.lastError ? `: ${first.lastError}` : ""}`,
    };
  }
  if (row.firing.length > 0) {
    return { state: "firing", reason: `${plural(row.firing.length, "alert")} firing` };
  }
  if (row.pending.length > 0) {
    return { state: "pending", reason: `${plural(row.pending.length, "alert")} pending` };
  }

  return {
    state: "healthy",
    reason: `Loaded by ${read.map((view) => describeSource(view.source)).join(", ")}`,
  };
}

export function ruleRows(inventory: RuleInventory): RuleRow[] {
  const namespaceLabels = namespaceLabelsOf(inventory.namespaces);
  const reads = new Map(inventory.reads.map((read) => [read.source, read]));

  return inventory.rules.map((rule) => {
    const namespace = namespaceOf(rule);
    const key = objectKey("PrometheusRule", namespace, rule.getName());
    const selection = ruleSelection(rule, inventory.sources, namespaceLabels);
    const live = selection.selectedBy.map((source) => liveViewOf(source, rule.metadata.uid, reads));
    // Every Prometheus that loads it evaluates it, so the first one read stands for the rest.
    const loaded = live.find((view) => view.groups && view.groups.length > 0)?.groups ?? [];
    const liveRules = loaded.flatMap((group) => group.rules);
    const alerts = liveRules.flatMap((each) => each.alerts ?? []);
    const groups = rule.spec.groups ?? [];
    const declared = groups.flatMap((group) => group.rules ?? []);
    const partial = {
      key,
      name: rule.getName(),
      namespace,
      rule,
      selection,
      rejection: rejectionOf(
        inventory.rejections.get(key),
        rule.metadata.uid,
        loaded.length > 0,
        selection,
      ),
      live,
      groups: groups.length,
      alerting: declared.filter((each) => each.alert).length,
      recording: declared.filter((each) => each.record).length,
      firing: alerts.filter((alert) => alert.state === "firing"),
      pending: alerts.filter((alert) => alert.state === "pending"),
      unhealthy: liveRules
        .filter((each) => each.health === "err")
        .map((each) => ({ name: each.name, lastError: each.lastError ?? "" })),
    };
    const { state, reason } = decide(partial);

    return { ...partial, state, verdict: { ...RULE_LOOK[state], reason } };
  });
}

export const loadedBy = (row: RuleRow): Source[] =>
  row.live.filter((view) => view.groups?.length).map((view) => view.source);

/** Where the pods of the Prometheuses read for rules run; agents and collectors hold none. */
export function ruleReadNamespaces(sources: Source[]): string[] {
  const read = sources.filter((source) => source.kind === "Prometheus" && !source.paused);

  return [...new Set(read.map((source) => source.namespace))].sort();
}

export type RuleFilter = "attention" | "firing" | "not-loaded" | "rejected" | "healthy" | "unknown";

const FILTER_STATES: Record<RuleFilter, readonly RuleState[]> = {
  attention: [
    "rejected",
    "not-selected",
    "namespace-excluded",
    "not-loaded",
    "unhealthy",
    "firing",
  ],
  firing: ["firing", "pending"],
  "not-loaded": ["not-selected", "namespace-excluded", "not-loaded"],
  rejected: ["rejected", "unhealthy"],
  healthy: ["healthy"],
  unknown: ["unknown"],
};

export const RULE_FILTERS = Object.keys(FILTER_STATES) as RuleFilter[];

/** Each filter chip's tooltip; the Overview's cards reuse them. */
export const RULE_FILTER_TITLES: Record<RuleFilter, string> = {
  attention: "Shows every rule that is not loaded, failing or firing",
  firing: "Shows rules with an alert firing or pending",
  "not-loaded": "Shows rules no Prometheus selects or loads",
  rejected: "Shows rules the operator refused or whose evaluation fails",
  healthy: "Shows rules loaded with nothing firing",
  unknown: "Shows rules no Prometheus that selects them could tell about",
};

export function matchesRuleFilter(row: RuleRow, filter: RuleFilter | undefined): boolean {
  return !filter || FILTER_STATES[filter].includes(row.state);
}

export function isRuleFilter(value: string | undefined): value is RuleFilter {
  return value !== undefined && value in FILTER_STATES;
}
