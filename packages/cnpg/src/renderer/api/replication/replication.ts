import type { ClusterLike, InstanceStatus, ReplicationInfo, SlotInfo } from "../shared/types";
import { RANK, type Tone, type Verdict } from "../shared/verdict";

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

// A designated primary is in recovery, so it reports how far it replayed, not a current LSN.
export function walPositionOf(status: InstanceStatus | undefined): string | undefined {
  return status?.currentLsn ?? status?.replayLsn;
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

/** Instances of the cluster the primary reports no connection from. */
function unconnectedReplicas(cluster: ClusterLike, primary: InstanceStatus): ReplicaLag[] {
  const connected = new Set((primary.replicationInfo ?? []).map((info) => info.applicationName));

  return (cluster.status?.instanceNames ?? [])
    .filter(
      (name) =>
        !connected.has(name) &&
        name !== cluster.status?.currentPrimary &&
        name !== cluster.status?.targetPrimary,
    )
    .map(
      (replica): ReplicaLag => ({
        replica,
        paused: false,
        verdict: {
          tone: "critical",
          label: "Not streaming",
          reason: "It is not connected to the primary.",
        },
      }),
    );
}

function lagVerdict(
  info: ReplicationInfo,
  bytes: number | undefined,
  seconds: number | undefined,
  paused: boolean,
): Verdict {
  const behind = `${formatBytes(bytes ?? 0)} behind${seconds ? `, ${seconds.toFixed(1)}s of replay delay` : ""}`;

  if (info.state && info.state !== "streaming") {
    return { tone: "critical", label: "Not streaming", reason: `Its connection is ${info.state}.` };
  }

  if (paused) {
    return {
      tone: "warning",
      label: "Replay paused",
      reason: `${behind}. Replay was paused by hand.`,
    };
  }

  if ((bytes ?? 0) > LAG_BYTES || (seconds ?? 0) > LAG_SECONDS) {
    return { tone: "warning", label: "Lagging", reason: `${behind}.` };
  }

  return { tone: "ok", label: "In sync", reason: `${behind}.` };
}

/** From the primary's view of each replica, plus each replica's own word on whether it is paused. */
export function replicaLags(
  primary: InstanceStatus | undefined,
  replicas: Record<string, InstanceStatus | undefined>,
  cluster?: ClusterLike,
): ReplicaLag[] {
  const missing = primary && cluster ? unconnectedReplicas(cluster, primary) : [];

  return (primary?.replicationInfo ?? [])
    .map((info): ReplicaLag => {
      const bytes = lsnDistance(primary?.currentLsn, info.replayLsn);
      const seconds = intervalSeconds(info.replayLag);
      const paused = replicas[info.applicationName]?.replayPaused === true;

      return {
        replica: info.applicationName,
        state: info.state,
        sync: info.syncState,
        bytes,
        seconds,
        paused,
        verdict: lagVerdict(info, bytes, seconds, paused),
      };
    })
    .concat(missing)
    .sort((a, b) => a.replica.localeCompare(b.replica));
}

/** The "namespace/pod" keys useInstanceStatuses reads the cluster's instances by. */
export function instanceKey(cluster: ClusterLike, pod: string | undefined): string {
  return `${cluster.getNs()}/${pod}`;
}

export function instanceKeys(cluster: ClusterLike): string[] {
  return (cluster.status?.instanceNames ?? []).map((name) => instanceKey(cluster, name));
}

export function primaryStatus(
  cluster: ClusterLike,
  statuses: Record<string, InstanceStatus | undefined> | undefined,
): InstanceStatus | undefined {
  return statuses?.[instanceKey(cluster, cluster.status?.currentPrimary)];
}

export function clusterLags(
  cluster: ClusterLike,
  statuses: Record<string, InstanceStatus | undefined> | undefined,
): ReplicaLag[] {
  const replicas = Object.fromEntries(
    (cluster.status?.instanceNames ?? []).map((name) => [
      name,
      statuses?.[instanceKey(cluster, name)],
    ]),
  );

  return replicaLags(primaryStatus(cluster, statuses), replicas, cluster);
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
  return [...lags].sort(
    (a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone] || (b.bytes ?? 0) - (a.bytes ?? 0),
  )[0];
}
