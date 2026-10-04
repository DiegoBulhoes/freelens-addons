import { Renderer } from "@freelensapp/extensions";

import type { Inventory } from "../api/attention";
import {
  Backup,
  Cluster,
  ObjectStore,
  Pooler,
  Publication,
  ScheduledBackup,
  Subscription,
} from "../api/kinds";
import { scopeKey, withinScope } from "../api/namespace-scope";
import { type LoadState, loadState } from "../api/store-state";
import type {
  BackupLike,
  ClusterLike,
  EventLike,
  ObjectStoreLike,
  PodDisruptionBudgetLike,
  PodLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SubscriptionLike,
} from "../api/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface CnpgStores extends Inventory {
  events: EventLike[];
  pods: PodLike[];
  budgets: PodDisruptionBudgetLike[];
  state: LoadState;
}

export function useCnpgStores(): CnpgStores {
  const clusterStore = useKubeStore(() => Cluster.getStore<Cluster>());
  const backupStore = useKubeStore(() => Backup.getStore<Backup>());
  const scheduleStore = useKubeStore(() => ScheduledBackup.getStore<ScheduledBackup>());
  const poolerStore = useKubeStore(() => Pooler.getStore<Pooler>());
  // Apart: without the Barman Cloud plugin it never registers, and must not hold the rest back.
  const objectStoreStore = useKubeStore(() => ObjectStore.getStore<ObjectStore>());
  const publicationStore = useKubeStore(() => Publication.getStore<Publication>());
  const subscriptionStore = useKubeStore(() => Subscription.getStore<Subscription>());
  const scope = useNamespaceScope();
  const key = scopeKey(scope);

  const gaveUp = useLoadedStores([clusterStore, backupStore, scheduleStore, poolerStore], key);
  useLoadedStores([objectStoreStore], key);
  useLoadedStores([publicationStore, subscriptionStore], key);
  useLoadedStores([Renderer.K8sApi.podsStore, Renderer.K8sApi.pdbStore], key);
  // The host's own store, shared with its Events page.
  useLoadedStores([Renderer.K8sApi.eventStore], key);

  const items = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  const clusters = items<ClusterLike>(clusterStore);

  return {
    clusters,
    backups: items<BackupLike>(backupStore),
    schedules: items<ScheduledBackupLike>(scheduleStore),
    poolers: items<PoolerLike>(poolerStore),
    objectStores: items<ObjectStoreLike>(objectStoreStore),
    events: items<EventLike>(Renderer.K8sApi.eventStore),
    publications: items<PublicationLike>(publicationStore),
    subscriptions: items<SubscriptionLike>(subscriptionStore),
    pods: items<PodLike>(Renderer.K8sApi.podsStore),
    budgets: items<PodDisruptionBudgetLike>(Renderer.K8sApi.pdbStore),
    state: loadState({
      registered: Boolean(clusterStore),
      loaded: Boolean(clusterStore?.isLoaded),
      itemCount: clusters.length,
      gaveUp,
    }),
  };
}
