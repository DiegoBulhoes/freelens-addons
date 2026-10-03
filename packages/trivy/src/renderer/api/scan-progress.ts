import type { WorkloadRow } from "./workload-rows";

const WORKING_WITHIN_MS = 15 * 60 * 1000;
// The operator's default rescan interval.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export type ScanState =
  | "nothing-known"
  | "complete"
  | "working"
  // Verdicts missing and none arrived recently.
  | "stalled"
  // All judged, some older than the rescan interval.
  | "stale";

export interface ScanProgress {
  state: ScanState;
  judged: number;
  total: number;
  recentRate: number;
  newestAgeMs?: number;
  oldestAgeMs?: number;
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
    // Undefined at a zero rate, which would print infinity.
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

export function describeDuration(milliseconds: number): string {
  // Checked before rounding: 30 seconds would round up to "1 minute".
  if (milliseconds < 60_000) return "less than a minute";

  const minutes = Math.round(milliseconds / 60_000);

  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);

  return `${days} day${days === 1 ? "" : "s"}`;
}

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
