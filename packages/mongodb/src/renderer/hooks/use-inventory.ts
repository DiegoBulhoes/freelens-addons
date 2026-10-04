import { agentKeys } from "../api/agent";
import { memberPodsOf, type ReplicaSetRow, replicaSetRows } from "../api/rows";
import { useAgents } from "./use-agents";
import { type MongoStores, useMongoStores } from "./use-mongodb-stores";
import { useSecretNames } from "./use-secret-names";

export interface MongoInventory {
  stores: MongoStores;
  rows: ReplicaSetRow[];
  /** Why member roles are missing: the agents could not be read. */
  agentError?: string;
}

export function useInventory(): MongoInventory {
  const stores = useMongoStores();
  const { agents, error } = useAgents(agentKeys(memberPodsOf(stores.replicaSets, stores.pods)));
  const secrets = useSecretNames(stores.namespaces);

  return {
    stores,
    rows: replicaSetRows({
      replicaSets: stores.replicaSets,
      pods: stores.pods,
      pvcs: stores.pvcs,
      secrets,
      agents,
    }),
    agentError: error,
  };
}
