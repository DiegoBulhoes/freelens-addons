import type { WorkloadRow } from "./workload-rows";

/**
 * Whether to wait or to investigate.
 *
 * The obvious question about a half-scanned cluster is "why did it fail", and
 * it is the wrong one: the operator's scan jobs are deleted as they finish, so
 * by the time anyone looks there is nothing to read. What can be read is when
 * each verdict was reached, and that answers the question people actually
 * have — a cluster steadily working through a rescan needs patience, one that
 * has not produced a verdict in an hour needs a look at the operator.
 */

/** A verdict this recent means the operator is working right now. */
const WORKING_WITHIN_MS = 15 * 60 * 1000;
/** The operator's own default rescan interval, so a verdict older than this is overdue. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export type ScanState =
  /** No workload is known: the operator is absent, or has not started. */
  | "nothing-known"
  /** Every known workload has a verdict, and none of them is overdue. */
  | "complete"
  /** Verdicts are still arriving and some workloads have none yet. */
  | "working"
  /** Workloads are missing a verdict and nothing has arrived recently. */
  | "stalled"
  /** Everything has a verdict, but some are older than the operator's own rescan interval. */
  | "stale";

export interface ScanProgress {
  state: ScanState;
  judged: number;
  total: number;
  /** Verdicts reached in the last hour; the basis of the estimate. */
  recentRate: number;
  newestAgeMs?: number;
  oldestAgeMs?: number;
  /** How long the remaining workloads would take at the observed rate. */
  estimatedRemainingMs?: number;
  staleCount: number;
}

function ageOf(row: WorkloadRow, now: number): number | undefined {
  if (!row.scannedAt) return undefined;

  const at = Date.parse(row.scannedAt);

  return Number.isNaN(at) ? undefined : now - at;
}

export function getScanProgress(rows: WorkloadRow[], now: number): ScanProgress {
  const ages = rows
    .map((row) => ageOf(row, now))
    .filter((age): age is number => age !== undefined && age >= 0);

  const judged = rows.filter((row) => row.state === "scanned").length;
  const outstanding = rows.length - judged;
  const recentRate = ages.filter((age) => age <= RATE_WINDOW_MS).length;
  const newestAgeMs = ages.length > 0 ? Math.min(...ages) : undefined;
  const oldestAgeMs = ages.length > 0 ? Math.max(...ages) : undefined;
  const staleCount = ages.filter((age) => age > STALE_AFTER_MS).length;

  return {
    state: stateOf({ rows: rows.length, outstanding, newestAgeMs, staleCount }),
    judged,
    total: rows.length,
    recentRate,
    newestAgeMs,
    oldestAgeMs,
    // Only offered while verdicts are actually arriving; extrapolating from a
    // rate of zero would print an infinity.
    estimatedRemainingMs:
      outstanding > 0 && recentRate > 0 ? (outstanding / recentRate) * RATE_WINDOW_MS : undefined,
    staleCount,
  };
}

function stateOf({
  rows,
  outstanding,
  newestAgeMs,
  staleCount,
}: {
  rows: number;
  outstanding: number;
  newestAgeMs?: number;
  staleCount: number;
}): ScanState {
  if (rows === 0) return "nothing-known";

  if (outstanding > 0) {
    return newestAgeMs !== undefined && newestAgeMs <= WORKING_WITHIN_MS ? "working" : "stalled";
  }

  return staleCount > 0 ? "stale" : "complete";
}

/** Rounded to the unit a person would say out loud, never to a false precision. */
export function describeDuration(milliseconds: number): string {
  // Tested before rounding: 30 seconds rounds up to a minute, and saying "1
  // minute" for half of one is a small lie the rest of this module avoids.
  if (milliseconds < 60_000) return "less than a minute";

  const minutes = Math.round(milliseconds / 60_000);

  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);

  return `${days} day${days === 1 ? "" : "s"}`;
}

/** The sentence the overview shows: what is happening, and whether to act. */
export function describeProgress(progress: ScanProgress): string {
  const { state, judged, total } = progress;

  if (state === "nothing-known") {
    return "The Trivy operator has not claimed any workload yet.";
  }

  if (state === "complete") {
    return `All ${total} workloads have a current verdict.`;
  }

  if (state === "stale") {
    return `All ${total} workloads have a verdict, but ${progress.staleCount} are older than the operator's own rescan interval.`;
  }

  const outstanding = total - judged;

  if (state === "working") {
    const estimate = progress.estimatedRemainingMs;

    return estimate === undefined
      ? `Scanning: ${judged} of ${total} judged, ${outstanding} to go.`
      : `Scanning: ${judged} of ${total} judged. At ${progress.recentRate} an hour the remaining ${outstanding} would take about ${describeDuration(estimate)}.`;
  }

  const idle =
    progress.newestAgeMs === undefined
      ? "no verdict has ever been reached"
      : `the last verdict was ${describeDuration(progress.newestAgeMs)} ago`;

  return `Stalled: ${outstanding} of ${total} workloads have no verdict and ${idle}. Check the operator.`;
}
