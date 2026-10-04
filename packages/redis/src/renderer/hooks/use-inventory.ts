import { type RedisRow, redisRows } from "../api/rows";
import { type RedisStores, useRedisStores } from "./use-redis-stores";
import { useSecretNames } from "./use-secret-names";

export interface RedisInventory {
  stores: RedisStores;
  rows: RedisRow[];
}

export function useInventory(): RedisInventory {
  const stores = useRedisStores();
  const secrets = useSecretNames(stores.namespaces);

  return {
    stores,
    rows: redisRows({ objects: stores.objects, pods: stores.pods, pvcs: stores.pvcs, secrets }),
  };
}
