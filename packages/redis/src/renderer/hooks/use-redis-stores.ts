import { Renderer } from "@freelensapp/extensions";

import { RedisCluster, RedisReplication, RedisSentinel, RedisStandalone } from "../api/kinds";
import { scopeKey, withinScope } from "../api/namespace-scope";
import { type LoadState, loadState } from "../api/store-state";
import type { EventLike, PodLike, PvcLike, RedisLike } from "../api/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface RedisStores {
  objects: RedisLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  events: EventLike[];
  namespaces: string[];
  state: LoadState;
}

export function useRedisStores(): RedisStores {
  // Each registers only once its CRD exists; one missing must not hold the others back.
  const standalones = useKubeStore(() => RedisStandalone.getStore<RedisStandalone>());
  const replications = useKubeStore(() => RedisReplication.getStore<RedisReplication>());
  const clusters = useKubeStore(() => RedisCluster.getStore<RedisCluster>());
  const sentinels = useKubeStore(() => RedisSentinel.getStore<RedisSentinel>());
  const scope = useNamespaceScope();
  const key = scopeKey(scope);

  const gaveUp = useLoadedStores([replications], key);
  useLoadedStores([standalones], key);
  useLoadedStores([clusters], key);
  useLoadedStores([sentinels], key);
  useLoadedStores([Renderer.K8sApi.podsStore, Renderer.K8sApi.pvcStore], key);
  // The host's own store, shared with its Events page.
  useLoadedStores([Renderer.K8sApi.eventStore], key);

  const items = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  const objects = [standalones, replications, clusters, sentinels].flatMap((store) =>
    items<RedisLike>(store),
  );

  return {
    objects,
    pods: items<PodLike>(Renderer.K8sApi.podsStore),
    pvcs: items<PvcLike>(Renderer.K8sApi.pvcStore),
    events: items<EventLike>(Renderer.K8sApi.eventStore),
    namespaces: [...new Set(objects.map((object) => object.getNs() ?? ""))].sort(),
    state: loadState({
      registered: Boolean(replications),
      loaded: Boolean(replications?.isLoaded),
      itemCount: objects.length,
      gaveUp,
    }),
  };
}
