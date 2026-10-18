import { type RedisRow, redisRows } from "../api/objects/rows";
import { tlsNamespaces } from "../api/objects/upkeep";
import { type RedisStores, useRedisStores } from "./use-redis-stores";
import { useSecretNames } from "./use-secret-names";

export interface RedisInventory {
  stores: RedisStores;
  rows: RedisRow[];
}

export function useInventory(): RedisInventory {
  const stores = useRedisStores();
  const secrets = useSecretNames(tlsNamespaces(stores.objects));

  return {
    stores,
    rows: redisRows({
      objects: stores.objects,
      pods: stores.pods,
      pvcs: stores.pvcs,
      podsRead: stores.podsRead,
      podsFailed: stores.podsFailed,
      secrets,
    }),
  };
}
