import { describeDuration } from "../shared/time";
import { DEFAULT_RESCAN_MS } from "../workloads/report-ttl";
import type { WorkloadRow } from "../workloads/workload-rows";

const WORKING_WITHIN_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export type ScanState =
  | "nothing-known"
  | "complete"
  | "working"
  // Verdicts missing and none arrived recently.
  | "stalled"
  // All judged, some older than their report-ttl.
  | "stale";

/** How many workloads were judged at a moment this page saw. */
export interface JudgedSample {
  at: number;
  judged: number;
}

export interface ScanProgress {
  state: ScanState;
  judged: number;
  total: number;
  /** Workloads judged since the first sample of the window; undefined until it is long enough. */
  judgedGrowth?: number;
  /** The span that growth was measured over. */
  observedMs?: number;
  /** Since the count last rose, or since the page started watching. */
  idleMs?: number;
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

export function judgedOf(allRows: WorkloadRow[]): number {
  return allRows.filter((row) => row.state === "scanned").length;
}

// One sample older than the window is kept as the baseline growth is measured from.
export function recordJudged(history: JudgedSample[], judged: number, now: number): JudgedSample[] {
  const grown = history.at(-1)?.judged === judged ? history : [...history, { at: now, judged }];
  const firstInWindow = grown.findIndex((sample) => now - sample.at <= RATE_WINDOW_MS);

  if (firstInWindow === -1) return grown.slice(-1);

  return firstInWindow === 0 ? grown : grown.slice(firstInWindow - 1);
}

interface Growth {
  growth: number;
  observedMs: number;
  idleMs: number;
}

// A rescan renews updateTimestamp without judging anything new, so only a new high is progress.
function growthOf(history: JudgedSample[], now: number): Growth | undefined {
  const [first] = history;
  const last = history.at(-1);

  if (!first || !last) return undefined;

  let highest = first.judged;
  let lastGrowthAt: number | undefined;

  for (const sample of history) {
    if (sample.judged > highest) {
      highest = sample.judged;
      lastGrowthAt = sample.at;
    }
  }

  const observedMs = now - first.at;

  if (lastGrowthAt === undefined && observedMs < WORKING_WITHIN_MS) return undefined;

  return {
    growth: last.judged - first.judged,
    observedMs,
    idleMs: now - (lastGrowthAt ?? first.at),
  };
}

function ageRange(
  rows: WorkloadRow[],
  now: number,
): { newestAgeMs?: number; oldestAgeMs?: number } {
  const known = rows
    .map((row) => ageOf(row, now))
    .filter((age): age is number => age !== undefined && age >= 0);

  if (known.length === 0) return {};

  return { newestAgeMs: Math.min(...known), oldestAgeMs: Math.max(...known) };
}

function countStale(rows: WorkloadRow[], now: number): number {
  return rows.filter((row) => {
    if (row.overdueAt !== undefined) return now > row.overdueAt;

    const age = ageOf(row, now);

    return age !== undefined && age > DEFAULT_RESCAN_MS;
  }).length;
}

// Undefined at no growth, which would print infinity.
function estimateRemaining(outstanding: number, measured: Growth | undefined): number | undefined {
  return outstanding > 0 && measured && measured.growth > 0
    ? (outstanding / measured.growth) * measured.observedMs
    : undefined;
}

// A scaled-away ReplicaSet is never scanned, so it would hold the state at stalled for good.
export function getScanProgress(
  allRows: WorkloadRow[],
  now: number,
  history: JudgedSample[] = [],
): ScanProgress {
  const rows = allRows.filter((row) => row.state !== "inactive");
  const judged = judgedOf(rows);
  const outstanding = rows.length - judged;
  const { newestAgeMs, oldestAgeMs } = ageRange(rows, now);
  const staleCount = countStale(rows, now);
  const measured = growthOf(recordJudged(history, judged, now), now);

  return {
    state: scanStateOf({ rows: rows.length, outstanding, newestAgeMs, staleCount, measured }),
    judged,
    total: rows.length,
    judgedGrowth: measured?.growth,
    observedMs: measured?.observedMs,
    idleMs: measured?.idleMs,
    newestAgeMs,
    oldestAgeMs,
    estimatedRemainingMs: estimateRemaining(outstanding, measured),
    staleCount,
  };
}

function scanStateOf({
  rows,
  outstanding,
  newestAgeMs,
  staleCount,
  measured,
}: {
  rows: number;
  outstanding: number;
  newestAgeMs?: number;
  staleCount: number;
  measured?: Growth;
}): ScanState {
  if (rows === 0) return "nothing-known";

  if (outstanding > 0) {
    // Until the page has watched long enough, a recent verdict is the only sign of work.
    if (!measured) {
      return newestAgeMs !== undefined && newestAgeMs <= WORKING_WITHIN_MS ? "working" : "stalled";
    }

    return measured.idleMs < WORKING_WITHIN_MS && measured.growth > 0 ? "working" : "stalled";
  }

  return staleCount > 0 ? "stale" : "complete";
}

export function describeProgress(progress: ScanProgress): string {
  const { state, judged, total } = progress;

  if (state === "nothing-known") {
    return "The Trivy operator has not claimed any workload yet.";
  }

  if (state === "complete") {
    return `All ${total} ${total === 1 ? "workload has" : "workloads have"} a current verdict.`;
  }

  if (state === "stale") {
    return `All ${total} ${total === 1 ? "workload has" : "workloads have"} a verdict, but ${progress.staleCount} ${progress.staleCount === 1 ? "is" : "are"} older than the operator's own rescan interval (their report-ttl). The commands below look at the operator.`;
  }

  const outstanding = total - judged;

  if (state === "working") {
    const estimate = progress.estimatedRemainingMs;

    return estimate === undefined
      ? `Scanning: ${judged} of ${total} judged, ${outstanding} to go.`
      : `Scanning: ${judged} of ${total} judged, ${progress.judgedGrowth} in the last ${describeDuration(progress.observedMs ?? 0)}. At that pace the remaining ${outstanding} would take about ${describeDuration(estimate)}.`;
  }

  const idle =
    progress.idleMs !== undefined
      ? `none was added in the last ${describeDuration(progress.idleMs)}`
      : progress.newestAgeMs === undefined
        ? "no verdict has ever been reached"
        : `the last verdict was ${describeDuration(progress.newestAgeMs)} ago`;

  return `Stalled: ${outstanding} of ${total} workloads have no verdict and ${idle}. The commands below look at the operator.`;
}
