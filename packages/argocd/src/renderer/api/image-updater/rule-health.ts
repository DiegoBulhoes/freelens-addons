import type { Tone } from "../../components/status";
import type { Application } from "../applications/application";
import type { LoadState } from "../shared/store-state";
import { ImageUpdater } from "./image-updater";
import { ruleSelections } from "./image-updates";

/** The controller's default `--interval`. */
export const DEFAULT_INTERVAL_MS = 2 * 60_000;

const MISSED_CHECKS_BEFORE_STALE = 5;

export type RuleState =
  | "failing"
  | "errors"
  | "never-checked"
  | "stale"
  | "skipped"
  | "matches-nothing"
  | "waiting"
  | "ok";

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
    const skipped = ruleSelections(updater, applications).filter((selection) => selection.skipped);
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
        stateRank(first.health.state) - stateRank(second.health.state) ||
        first.updater.getName().localeCompare(second.updater.getName()),
    );
}

export function describeRulesHeadline(
  state: LoadState,
  needingAttention: number,
  total: number,
): string {
  if (state === "connecting") return "Looking for Image Updater rules…";
  if (state === "unreachable") return "Cannot read the Image Updater rules";
  if (state === "not-installed" || total === 0) return "No Image Updater rules found";
  if (needingAttention === 0) {
    return total === 1
      ? "The only Image Updater rule is watching"
      : `All ${total} Image Updater rules are watching`;
  }

  return `${needingAttention} of ${total} Image Updater ${total === 1 ? "rule needs" : "rules need"} attention`;
}

const needsAttention = (row: RuleRow) =>
  row.health.tone === "critical" || row.health.tone === "warning";

export function needingAttention(rows: RuleRow[]): RuleRow[] {
  return rows.filter(needsAttention);
}

/** The Rules list's filters; the Overview's cards count with the same ones. */
export const RULE_FILTERS = { attention: needsAttention } as const;

export type RuleFilter = keyof typeof RULE_FILTERS;

export function describeRulesState(state: LoadState): string | undefined {
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the Image Updater rules, so what is below may be incomplete.";
  }
  if (state === "not-installed") return "This cluster has no ImageUpdater CRD.";

  return undefined;
}

/** Image Updater v1.3.0 exits on start if any rule fails, so a restart then crash-loops. */
export function restartRefusal(rows: RuleRow[]): string | undefined {
  const refused = rows.filter((row) => row.health.state === "failing");

  if (refused.length === 0) return undefined;

  const names = refused.map((row) => row.updater.getName()).join(", ");

  return `The controller refuses ${names}, and it does not start while a rule it refuses exists: a restart would leave it crash-looping. Fix or delete ${refused.length === 1 ? "that rule" : "those rules"} first.`;
}
