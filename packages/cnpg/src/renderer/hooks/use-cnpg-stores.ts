import { Renderer } from "@freelensapp/extensions";

import type { Inventory } from "../api/overview/attention";
import {
  Backup,
  Cluster,
  ObjectStore,
  Pooler,
  Publication,
  ScheduledBackup,
  Subscription,
} from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import {
  type Failures,
  failedEverywhere,
  type KindStates,
  type LoadState,
  loadedForScope,
  loadState,
  type PageLoad,
  pageLoad,
  type StorePage,
  shownScope,
} from "../api/shared/store-state";
import type {
  BackupLike,
  ClusterLike,
  ObjectStoreLike,
  PodDisruptionBudgetLike,
  PodLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SubscriptionLike,
} from "../api/shared/types";
import { useKubeStore } from "../components/use-kube-store";
import { type LoadedStore, useLoadedStore } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface CnpgStores extends Inventory {
  budgets: PodDisruptionBudgetLike[];
  /** Of the clusters. */
  state: LoadState;
  states: KindStates;
  failures: Failures;
  /** Of the page asked for: the worst of its lists, and the namespaces left out. */
  load: PageLoad;
}

type Loadable = { isLoaded: boolean; items: unknown[] } | undefined;

/** Every list, shown only in the namespaces where each list the page stands on was read. */
export function useCnpgStores(page: StorePage): CnpgStores {
  const clusterStore = useKubeStore(() => Cluster.getStore<Cluster>());
  const backupStore = useKubeStore(() => Backup.getStore<Backup>());
  const scheduleStore = useKubeStore(() => ScheduledBackup.getStore<ScheduledBackup>());
  const poolerStore = useKubeStore(() => Pooler.getStore<Pooler>());
  const objectStoreStore = useKubeStore(() => ObjectStore.getStore<ObjectStore>());
  const publicationStore = useKubeStore(() => Publication.getStore<Publication>());
  const subscriptionStore = useKubeStore(() => Subscription.getStore<Subscription>());
  const { podsStore, pdbStore } = Renderer.K8sApi;
  const scope = [...useNamespaceScope()].sort();
  const key = scopeKey(scope);

  // One load per kind: a refused or missing kind must not hold the others back or hide them.
  const loads = {
    clusters: useLoadedStore(clusterStore, scope, "clusters"),
    backups: useLoadedStore(backupStore, scope, "backups"),
    schedules: useLoadedStore(scheduleStore, scope, "scheduledbackups"),
    poolers: useLoadedStore(poolerStore, scope, "poolers"),
    objectStores: useLoadedStore(objectStoreStore, scope, "objectstores"),
    publications: useLoadedStore(publicationStore, scope, "publications"),
    subscriptions: useLoadedStore(subscriptionStore, scope, "subscriptions"),
    pods: useLoadedStore(podsStore, scope, "pods"),
    budgets: useLoadedStore(pdbStore, scope, "poddisruptionbudgets"),
  };

  const stateOf = (store: Loadable, load: LoadedStore) =>
    loadState({
      registered: Boolean(store),
      loaded: store ? loadedForScope([store], load.loadedFor, key) : false,
      gaveUp: load.gaveUp,
      refused: failedEverywhere(load.failed, scope),
    });
  const states: KindStates = {
    clusters: stateOf(clusterStore, loads.clusters),
    backups: stateOf(backupStore, loads.backups),
    schedules: stateOf(scheduleStore, loads.schedules),
    poolers: stateOf(poolerStore, loads.poolers),
    objectStores: stateOf(objectStoreStore, loads.objectStores),
    publications: stateOf(publicationStore, loads.publications),
    subscriptions: stateOf(subscriptionStore, loads.subscriptions),
    pods: stateOf(podsStore, loads.pods),
    budgets: stateOf(pdbStore, loads.budgets),
  };
  const failures: Failures = Object.fromEntries(
    Object.entries(loads).map(([kind, load]) => [kind, load.failed]),
  );
  const load = pageLoad(states, page, failures);
  const shown = shownScope(scope, failures, page, load.state);
  const items = <T extends { getNs(): string | undefined }>(store: Loadable) =>
    withinScope((store?.items ?? []) as T[], shown);

  return {
    clusters: items<ClusterLike>(clusterStore),
    backups: items<BackupLike>(backupStore),
    schedules: items<ScheduledBackupLike>(scheduleStore),
    poolers: items<PoolerLike>(poolerStore),
    objectStores: items<ObjectStoreLike>(objectStoreStore),
    publications: items<PublicationLike>(publicationStore),
    subscriptions: items<SubscriptionLike>(subscriptionStore),
    // Unknown until read for this scope: a pooler is then judged without its pods.
    pods: states.pods === "ready" ? items<PodLike>(podsStore) : undefined,
    budgets: items<PodDisruptionBudgetLike>(pdbStore),
    state: states.clusters,
    states,
    failures,
    load,
  };
}
