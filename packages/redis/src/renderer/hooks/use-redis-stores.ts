import { Renderer } from "@freelensapp/extensions";

import {
  RedisCluster,
  RedisReplication,
  RedisSentinel,
  RedisStandalone,
} from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import {
  type Failures,
  failedEverywhere,
  inventoryState,
  type LoadState,
  loadedForScope,
} from "../api/shared/store-state";
import type { PodLike, PvcLike, RedisLike } from "../api/shared/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStore } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface RedisStores {
  objects: RedisLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  /** False until the pods and volumes are read for this scope. */
  podsRead: boolean;
  /** Namespaces whose pods or volumes were refused: their rows are not judged. */
  podsFailed: ReadonlySet<string>;
  /** By kind, the namespaces refused while the rest were read. */
  failures: Failures;
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
  const { podsStore, pvcStore } = Renderer.K8sApi;

  const standalonesLoad = useLoadedStore(standalones, key, "standalones");
  const replicationsLoad = useLoadedStore(replications, key, "replications");
  const clustersLoad = useLoadedStore(clusters, key, "clusters");
  const sentinelsLoad = useLoadedStore(sentinels, key, "sentinels");
  // Apart: a refused PVC list must not hold back the pods watch.
  const podsLoad = useLoadedStore(podsStore, key, "pods");
  const pvcsLoad = useLoadedStore(pvcStore, key, "volumes");

  const scopedItems = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  const objects = [standalones, replications, clusters, sentinels].flatMap((store) =>
    scopedItems<RedisLike>(store),
  );
  const podsRead =
    loadedForScope([podsStore], podsLoad.loadedFor, key) &&
    loadedForScope([pvcStore], pvcsLoad.loadedFor, key);
  const podsFailed = new Set([...podsLoad.failed, ...pvcsLoad.failed]);
  const crds = [
    { kind: "Standalones", store: standalones, load: standalonesLoad },
    { kind: "Replications", store: replications, load: replicationsLoad },
    { kind: "Clusters", store: clusters, load: clustersLoad },
    { kind: "Sentinels", store: sentinels, load: sentinelsLoad },
  ] as const;

  return {
    objects,
    pods: scopedItems<PodLike>(podsStore),
    pvcs: scopedItems<PvcLike>(pvcStore),
    podsRead,
    podsFailed,
    failures: {
      ...Object.fromEntries(crds.map(({ kind, load }) => [kind, load.failed])),
      Pods: podsLoad.failed,
      PersistentVolumeClaims: pvcsLoad.failed,
    },
    namespaces: [...new Set(objects.map((object) => object.getNs() ?? ""))].sort(),
    state: inventoryState(
      crds.map(({ store, load }) => ({
        registered: Boolean(store),
        loaded: store ? loadedForScope([store], load.loadedFor, key) : false,
        gaveUp: load.gaveUp,
        failed: failedEverywhere(load.failed, scope),
      })),
      {
        registered: true,
        loaded: podsRead,
        gaveUp: podsLoad.gaveUp || pvcsLoad.gaveUp,
        failed: failedEverywhere(podsFailed, scope),
      },
    ),
  };
}
