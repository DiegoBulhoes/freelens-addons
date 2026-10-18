import { isChangingVersion } from "../clusters/replica-sets";
import type { AttentionItem, ReplicaSetRow } from "../clusters/rows";
import type { LoadState } from "./store-state";
import type { Verdict } from "./verdict";

const REPLICA_SET_PREDICATES = {
  critical: (row: ReplicaSetRow) => row.health.tone === "critical",
  degraded: (row: ReplicaSetRow) => row.health.label === "Degraded",
  "changing-version": (row: ReplicaSetRow) => isChangingVersion(row.rs),
  "no-password": (row: ReplicaSetRow) => row.users.some((view) => !view.hasPassword),
  "no-tls-secret": (row: ReplicaSetRow) => row.tls.missing.length > 0,
};

export type ReplicaSetFilter = keyof typeof REPLICA_SET_PREDICATES;

export const REPLICA_SET_FILTERS = Object.keys(REPLICA_SET_PREDICATES) as ReplicaSetFilter[];

export const REPLICA_SET_FILTER_LABELS: Record<ReplicaSetFilter, string> = {
  critical: "Down, failed or no primary",
  degraded: "Degraded",
  "changing-version": "Changing version",
  "no-password": "Missing a password Secret",
  "no-tls-secret": "Missing a TLS Secret",
};

export const REPLICA_SET_FILTER_TITLES: Record<ReplicaSetFilter, string> = {
  critical: "Shows the clusters that are down, failed, or up with no primary",
  degraded: "Shows the clusters with some of their members not ready",
  "changing-version": "Shows the clusters moving from the version they run to another",
  "no-password": "Shows the clusters with a user whose password Secret does not exist",
  "no-tls-secret": "Shows the clusters whose TLS certificate or CA Secret does not exist",
};

export function isReplicaSetFilter(value: string | undefined): value is ReplicaSetFilter {
  return value !== undefined && value in REPLICA_SET_PREDICATES;
}

export function matchesReplicaSetFilter(
  row: ReplicaSetRow,
  filter: ReplicaSetFilter | undefined,
): boolean {
  return !filter || REPLICA_SET_PREDICATES[filter](row);
}

/** What the Clusters page opens on: a drawer by namespace and name, or a filter. */
export interface ReplicaSetsParams {
  namespace?: string;
  name?: string;
  filter?: ReplicaSetFilter;
}

export type OpenReplicaSets = (params?: ReplicaSetsParams) => void;

/** `namespace/name`, as the list keys its rows; undefined unless both are named. */
export function namedKey(namespace: string | undefined, name: string | undefined) {
  return namespace && name ? `${namespace}/${name}` : undefined;
}

const FILTER_TONES: Record<ReplicaSetFilter, Verdict["tone"]> = {
  critical: "critical",
  degraded: "warning",
  "changing-version": "info",
  "no-password": "critical",
  "no-tls-secret": "critical",
};

export type ReplicaSetCounts = { replicaSets: number } & Record<ReplicaSetFilter, number>;

export interface Card {
  label: string;
  value: number;
  tone?: Verdict["tone"];
  title: string;
  opens: ReplicaSetsParams;
}

/** None before the lists are read: a zero there would claim what no list has said. */
export function cardsOf(counts: ReplicaSetCounts, state: LoadState): Card[] {
  if (state !== "ready") return [];

  return [
    { label: "Clusters", value: counts.replicaSets, title: "Opens every cluster", opens: {} },
    ...REPLICA_SET_FILTERS.map((filter) => ({
      label: REPLICA_SET_FILTER_LABELS[filter],
      value: counts[filter],
      tone: FILTER_TONES[filter],
      title: REPLICA_SET_FILTER_TITLES[filter].replace(/^Shows /, "Opens "),
      opens: { filter },
    })),
  ];
}

/** An attention row opens its own cluster's drawer. */
export function destinationOf(item: AttentionItem): ReplicaSetsParams {
  return { namespace: item.namespace, name: item.replicaSet };
}
