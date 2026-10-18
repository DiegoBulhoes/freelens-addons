import { COLLECTOR_CONTAINER } from "../coverage/workload-pods";
import type { ContainerStatus, PodLike } from "../shared/types";

// CrashLoopBackOff waits at most five minutes between runs; past twice that, an exit is history.
export const CRASH_WINDOW = 10 * 60_000;

export interface Crash {
  pod: PodLike;
  exitCode?: number;
  reason?: string;
  restarts: number;
}

/** A container's status; a sidecar collector runs as a native sidecar, among the init containers. */
export function containerStatusOf(pod: PodLike, container: string): ContainerStatus | undefined {
  return [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ].find((status) => status.name === container);
}

export function collectorStatusOf(pod: PodLike): ContainerStatus | undefined {
  return containerStatusOf(pod, COLLECTOR_CONTAINER);
}

/** Crashing now, not once: in back-off, or not ready after an exit within the window. */
export function crashOf(
  pod: PodLike,
  now: number,
  container = COLLECTOR_CONTAINER,
): Crash | undefined {
  const status = containerStatusOf(pod, container);

  if (!status) return undefined;

  const exit = status.state?.terminated ?? status.lastState?.terminated;
  const backOff = status.state?.waiting?.reason === "CrashLoopBackOff";
  const recent =
    !status.ready && !!exit?.finishedAt && now - Date.parse(exit.finishedAt) <= CRASH_WINDOW;

  if (!backOff && !recent) return undefined;

  return { pod, exitCode: exit?.exitCode, reason: exit?.reason, restarts: status.restartCount };
}

// The operator sets no termination message, so the log is read; an OOM kill leaves nothing there.
export function needsLog(crash: Crash): boolean {
  return crash.reason !== "OOMKilled";
}

/** Before its back-off the exited run is still the current one, and the one before it may be gone. */
export function crashLogIsPrevious(pod: PodLike): boolean {
  return !collectorStatusOf(pod)?.state?.terminated;
}

/** A new crash is a new run, so a new read. */
export function causeKey(pod: PodLike): string {
  return `${pod.metadata.uid}/${collectorStatusOf(pod)?.restartCount ?? 0}`;
}

/** The line the collector's command prints as `Error: …` before it exits, else a Go panic's first. */
export function causeFromLog(log: string): string | undefined {
  const lines = log.split("\n").map((line) => line.trim());

  for (const line of [...lines].reverse()) {
    const match = /^Error: (.+)$/.exec(line);

    if (match) return match[1];
  }

  return lines.find((line) => /^panic: ./.test(line));
}

// A page of crashing pods must not fire a log request each.
export const MAX_READS = 8;
// Between restarts the previous log is briefly empty or unreadable, so such a read is tried again.
export const MAX_ATTEMPTS = 3;
export const RETRY_MS = 5_000;
export const UNREADABLE = "its previous log could not be read";
// The kubelet answers a removed container's log with this text instead of an error.
const LOG_GONE = /^unable to retrieve container logs for /;

export interface CauseRead {
  cause?: string;
  attempts: number;
  /** When the last read gave nothing; unset while one is in flight. */
  missedAt?: number;
  /** Never read again: a log came back, or the attempts are spent. */
  final: boolean;
}

/** How long a missed read waits before the next attempt: doubling from RETRY_MS. */
export function backOffOf(read: CauseRead): number {
  return RETRY_MS * 2 ** Math.max(0, read.attempts - 1);
}

function dueAt(read: CauseRead): number | undefined {
  if (read.final || read.missedAt === undefined) return undefined;

  return read.missedAt + backOffOf(read);
}

export function isDue(read: CauseRead | undefined, now: number): boolean {
  if (!read) return true;

  const due = dueAt(read);

  return due !== undefined && now >= due;
}

export function startRead(read: CauseRead | undefined): CauseRead {
  return { cause: read?.cause, attempts: (read?.attempts ?? 0) + 1, final: false };
}

/** A log with text is the answer, cause or not; an empty or refused read is tried again. */
export function afterRead(
  read: CauseRead,
  outcome: { log: string } | { error: unknown },
  now: number,
): CauseRead {
  if ("log" in outcome && outcome.log.trim() && !LOG_GONE.test(outcome.log.trim())) {
    return { attempts: read.attempts, cause: causeFromLog(outcome.log), final: true };
  }

  return {
    attempts: read.attempts,
    cause: "log" in outcome ? undefined : UNREADABLE,
    missedAt: now,
    final: read.attempts >= MAX_ATTEMPTS,
  };
}

/** How many reads may start while `inFlight` are under way. */
export function readSlots(inFlight: number): number {
  return Math.max(0, MAX_READS - inFlight);
}

/** Milliseconds until the first missed read is due again; undefined when none will be. */
export function retryIn(reads: (CauseRead | undefined)[], now: number): number | undefined {
  const waits = reads.flatMap((read) => {
    const due = read && dueAt(read);

    return due === undefined ? [] : [Math.max(0, due - now)];
  });

  return waits.length > 0 ? Math.min(...waits) : undefined;
}
