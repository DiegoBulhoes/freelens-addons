import { Renderer } from "@freelensapp/extensions";

import { MongoDBCommunity } from "../api/kinds";
import { scopeKey, withinScope } from "../api/namespace-scope";
import { type LoadState, loadState } from "../api/store-state";
import type { EventLike, PodLike, PvcLike, ReplicaSetLike } from "../api/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface MongoStores {
  replicaSets: ReplicaSetLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  events: EventLike[];
  namespaces: string[];
  state: LoadState;
}

export function useMongoStores(): MongoStores {
  const replicaSetStore = useKubeStore(() => MongoDBCommunity.getStore<MongoDBCommunity>());
  const scope = useNamespaceScope();
  const key = scopeKey(scope);

  const gaveUp = useLoadedStores([replicaSetStore], key);
  useLoadedStores([Renderer.K8sApi.podsStore, Renderer.K8sApi.pvcStore], key);
  // The host's own store, shared with its Events page.
  useLoadedStores([Renderer.K8sApi.eventStore], key);

  const items = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  const replicaSets = items<ReplicaSetLike>(replicaSetStore);

  return {
    replicaSets,
    pods: items<PodLike>(Renderer.K8sApi.podsStore),
    pvcs: items<PvcLike>(Renderer.K8sApi.pvcStore),
    events: items<EventLike>(Renderer.K8sApi.eventStore),
    namespaces: [...new Set(replicaSets.map((rs) => rs.getNs() ?? ""))].sort(),
    state: loadState({
      registered: Boolean(replicaSetStore),
      loaded: Boolean(replicaSetStore?.isLoaded),
      itemCount: replicaSets.length,
      gaveUp,
    }),
  };
}
