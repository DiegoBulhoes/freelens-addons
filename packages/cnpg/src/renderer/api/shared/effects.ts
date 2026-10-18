import type { ClusterBulk } from "../writes/bulk";

/** What each cluster action does: the drawer's toolbar and the selection bar say the same. */
export const CLUSTER_EFFECTS: Record<ClusterBulk, string> = {
  backup: "Starts a backup now, with the cluster's own method",
  reload: "Reloads the configuration without restarting",
  wake: "Wakes the cluster on its kept volumes",
  hibernate: "Stops the cluster and keeps its volumes",
  restart: "Recreates every instance, one at a time",
};

export function bulkEffect(action: ClusterBulk): string {
  return `${CLUSTER_EFFECTS[action]}, on each ticked cluster that can take it.`;
}
