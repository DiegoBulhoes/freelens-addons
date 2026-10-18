import { isHibernated } from "../clusters/clusters";
import type { ClusterRow } from "../overview/attention";
import type { Verdict } from "./verdict";

export type Page = "clusters" | "backups" | "schedules" | "poolers" | "logical";

/** The one row a list opens the drawer of, or, for Backups, the cluster it narrows to. */
export interface RowParams {
  kind?: string;
  namespace?: string;
  name?: string;
  cluster?: string;
}

export type OpenPage = (page: Page, params?: RowParams & { filter?: string }) => void;

/** `namespace/name`, the key of an object's row in every list. */
export function keyOf(object: { getNs(): string | undefined; getName(): string }): string {
  return `${object.getNs()}/${object.getName()}`;
}

/** `namespace/name`, as every list keys its rows; undefined unless both are named. */
export function namedKey(namespace: string | undefined, name: string | undefined) {
  return namespace && name ? `${namespace}/${name}` : undefined;
}

const CLUSTER_PREDICATES = {
  "not-ready": (row: ClusterRow) => row.health.tone === "critical",
  "at-risk": (row: ClusterRow) => row.backup.tone === "critical",
  "no-backup": (row: ClusterRow) => row.backup.label === "No backup",
  hibernated: (row: ClusterRow) => isHibernated(row.cluster),
};

export type ClusterFilter = keyof typeof CLUSTER_PREDICATES;

export const CLUSTER_FILTERS = Object.keys(CLUSTER_PREDICATES) as ClusterFilter[];

export const CLUSTER_FILTER_LABELS: Record<ClusterFilter, string> = {
  "not-ready": "Not ready",
  "at-risk": "Cannot be restored safely",
  "no-backup": "No backup",
  hibernated: "Hibernated",
};

export const CLUSTER_FILTER_TITLES: Record<ClusterFilter, string> = {
  "not-ready": "Shows the clusters whose state is critical",
  "at-risk": "Shows the clusters whose backups are critical: none, failing or not archiving",
  "no-backup": "Shows the clusters with no backup method and no completed backup",
  hibernated: "Shows the hibernated clusters",
};

export function isClusterFilter(value: string | undefined): value is ClusterFilter {
  return value !== undefined && value in CLUSTER_PREDICATES;
}

export function matchesClusterFilter(row: ClusterRow, filter: ClusterFilter | undefined): boolean {
  return !filter || CLUSTER_PREDICATES[filter](row);
}

export type PoolerFilter = "down";

export const POOLER_FILTERS: PoolerFilter[] = ["down"];

export const POOLER_FILTER_LABELS: Record<PoolerFilter, string> = { down: "Down" };

export const POOLER_FILTER_TITLES: Record<PoolerFilter, string> = {
  down: "Shows the poolers whose state is critical",
};

export function isPoolerFilter(value: string | undefined): value is PoolerFilter {
  return value === "down";
}

export function matchesPoolerFilter(verdict: Verdict, filter: PoolerFilter | undefined): boolean {
  return !filter || verdict.tone === "critical";
}

/** A card's tooltip says what the list it opens shows. */
export const opensTitle = (chipTitle: string) => chipTitle.replace(/^Shows /, "Opens ");

/** The `namespace/name` of the cluster an object belongs to, as the cluster's own row key. */
export function clusterKeyOf(object: {
  getNs(): string | undefined;
  spec: { cluster: { name: string } };
}): string {
  return `${object.getNs()}/${object.spec.cluster.name}`;
}
