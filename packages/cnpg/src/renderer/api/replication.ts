import type { Tone, Verdict } from "./clusters";
import type { InstanceStatus, SlotInfo } from "./types";

/** Past this much WAL not yet replayed, a replica is lagging. */
export const LAG_BYTES = 16 * 1024 * 1024;
/** Or past this much replay delay. */
export const LAG_SECONDS = 30;

// An LSN is "high/low", each 32-bit hex; the difference stays well inside a double.
export function lsnToNumber(lsn: string | undefined): number | undefined {
  const match = /^([0-9A-Fa-f]+)\/([0-9A-Fa-f]+)$/.exec(lsn ?? "");

  return match
    ? Number.parseInt(match[1] ?? "0", 16) * 2 ** 32 + Number.parseInt(match[2] ?? "0", 16)
    : undefined;
}

export function lsnDistance(
  ahead: string | undefined,
  behind: string | undefined,
): number | undefined {
  const a = lsnToNumber(ahead);
  const b = lsnToNumber(behind);

  return a === undefined || b === undefined ? undefined : Math.max(0, a - b);
}

/** Postgres intervals as the instance manager prints them: "00:00:02.511538". */
export function intervalSeconds(interval: string | undefined): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(interval ?? "");

  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export interface ReplicaLag {
  replica: string;
  state?: string;
  sync?: string;
  bytes?: number;
  seconds?: number;
  paused: boolean;
  verdict: Verdict;
}

/** From the primary's view of each replica, plus each replica's own word on whether it is paused. */
export function replicaLags(
  primary: InstanceStatus | undefined,
  replicas: Record<string, InstanceStatus | undefined>,
): ReplicaLag[] {
  return (primary?.replicationInfo ?? [])
    .map((info) => {
      const bytes = lsnDistance(primary?.currentLsn, info.replayLsn);
      const seconds = intervalSeconds(info.replayLag);
      const paused = replicas[info.applicationName]?.replayPaused === true;
      const behind = `${formatBytes(bytes ?? 0)} behind${seconds ? `, ${seconds.toFixed(1)}s of replay delay` : ""}`;
      let verdict: Verdict;

      if (info.state && info.state !== "streaming") {
        verdict = {
          tone: "critical",
          label: "Not streaming",
          reason: `Its connection is ${info.state}.`,
        };
      } else if (paused) {
        verdict = {
          tone: "warning",
          label: "Replay paused",
          reason: `${behind}. Replay was paused by hand.`,
        };
      } else if ((bytes ?? 0) > LAG_BYTES || (seconds ?? 0) > LAG_SECONDS) {
        verdict = { tone: "warning", label: "Lagging", reason: `${behind}.` };
      } else {
        verdict = { tone: "ok", label: "In sync", reason: `${behind}.` };
      }

      return {
        replica: info.applicationName,
        state: info.state,
        sync: info.syncState,
        bytes,
        seconds,
        paused,
        verdict,
      };
    })
    .sort((a, b) => a.replica.localeCompare(b.replica));
}

export interface SlotRow {
  slot: SlotInfo;
  retainedBytes?: number;
  tone: Tone;
}

/** An inactive slot keeps WAL on the primary until it is used or dropped. */
export function slotRows(primary: InstanceStatus | undefined): SlotRow[] {
  return (primary?.replicationSlotsInfo ?? []).map((slot) => ({
    slot,
    retainedBytes: lsnDistance(primary?.currentLsn, slot.restartLsn),
    tone:
      slot.active === false || slot.walStatus === "lost" || slot.walStatus === "unreserved"
        ? "warning"
        : "ok",
  }));
}

export function worstLag(lags: ReplicaLag[]): ReplicaLag | undefined {
  const rank: Record<Tone, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

  return [...lags].sort(
    (a, b) => rank[a.verdict.tone] - rank[b.verdict.tone] || (b.bytes ?? 0) - (a.bytes ?? 0),
  )[0];
}
