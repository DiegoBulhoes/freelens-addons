import { agentTargetsOf, type ReplicaSetRow, replicaSetRows } from "../api/clusters/rows";
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
  const { agents, error } = useAgents(agentTargetsOf(stores.replicaSets, stores.pods));
  const secrets = useSecretNames(stores.namespaces);

  return {
    stores,
    rows: replicaSetRows({ ...stores, secrets, agents }),
    agentError: error,
  };
}
