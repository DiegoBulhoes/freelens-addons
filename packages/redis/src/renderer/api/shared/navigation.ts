import type { RowFilter } from "../objects/rows";
import type { RedisKind } from "./types";

export type OpenPage = (
  kind: RedisKind,
  params?: { namespace?: string; name?: string; filter?: RowFilter },
) => void;

export const KIND_TITLES: Record<RedisKind, string> = {
  Replication: "Replications",
  Cluster: "Clusters",
  Standalone: "Standalones",
  Sentinel: "Sentinels",
};
