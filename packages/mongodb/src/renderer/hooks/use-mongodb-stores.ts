import { Renderer } from "@freelensapp/extensions";

import { MongoDBCommunity } from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import {
  failedAmong,
  inventoryState,
  type LoadState,
  loadedForScope,
  loadState,
  type PodsRead,
  podsReadOf,
} from "../api/shared/store-state";
import type { PodLike, PvcLike, ReplicaSetLike } from "../api/shared/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStore } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface MongoStores {
  replicaSets: ReplicaSetLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  namespaces: string[];
  state: LoadState;
  podsRead: PodsRead;
  /** Namespaces whose pods were refused: their members are not judged. */
  podsFailed: ReadonlySet<string>;
}

export function useMongoStores(): MongoStores {
  const replicaSetStore = useKubeStore(() => MongoDBCommunity.getStore<MongoDBCommunity>());
  const scope = useNamespaceScope();
  const key = scopeKey(scope);
  const { podsStore, pvcStore } = Renderer.K8sApi;

  const replicaSetsLoad = useLoadedStore(replicaSetStore, key, "clusters");
  // Apart: a refused PVC list must not hold back the pods watch.
  const podsLoad = useLoadedStore(podsStore, key, "pods");
  useLoadedStore(pvcStore, key, "volumes");

  const items = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  const replicaSets = items<ReplicaSetLike>(replicaSetStore);
  const namespaces = [...new Set(replicaSets.map((rs) => rs.getNs() ?? ""))].sort();
  const podsLoaded = loadedForScope([podsStore], podsLoad.loadedFor, key);

  return {
    replicaSets,
    pods: items<PodLike>(podsStore),
    pvcs: items<PvcLike>(pvcStore),
    namespaces,
    state: inventoryState(
      loadState({
        registered: Boolean(replicaSetStore),
        loaded: Boolean(replicaSetStore?.isLoaded),
        itemCount: replicaSets.length,
        gaveUp: replicaSetsLoad.gaveUp,
        failed: replicaSetsLoad.failed.size > 0,
      }),
      loadState({
        registered: true,
        loaded: podsLoaded,
        itemCount: 0,
        gaveUp: podsLoad.gaveUp,
        failed: failedAmong(podsLoad.failed, namespaces),
      }),
    ),
    podsRead: podsReadOf(podsLoaded, podsLoad.gaveUp),
    podsFailed: podsLoad.failed,
  };
}
