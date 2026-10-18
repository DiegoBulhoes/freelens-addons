import { Renderer } from "@freelensapp/extensions";
import { useCallback, useMemo, useRef } from "react";

import { Instrumentation, OpenTelemetryCollector } from "../api/shared/kinds";
import {
  everyNamespace,
  everywhereKey,
  scopeKey,
  withinScope,
} from "../api/shared/namespace-scope";
import { type LoadState, loadedForScope, loadState } from "../api/shared/store-state";
import type {
  CollectorLike,
  InstrumentationLike,
  NamespaceLike,
  PodLike,
  WorkloadLike,
} from "../api/shared/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface OtelStores {
  workloads: WorkloadLike[];
  pods: PodLike[];
  /** Every Namespace, for its opt-in annotations. */
  namespaces: NamespaceLike[];
  /** Every namespace's, whatever the scope; undefined until this page's own read lands. */
  instrumentations?: InstrumentationLike[];
  collectors: CollectorLike[];
  /** Every namespace's, for a sidecar annotation; undefined until this page's own read lands. */
  everyCollector?: CollectorLike[];
  /** The every-namespace reads given up on, or with no CRD to read. */
  gaveUp: { instrumentations: boolean; collectors: boolean };
  scope: readonly string[];
  /** Of what the Coverage rows stand on: the Instrumentations and the workloads. */
  coverageState: LoadState;
  collectorState: LoadState;
}

interface NamespacedStore {
  loadAll(params?: { namespaces?: string[] }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

// A value may name `namespace/name` outside the selected namespaces.
function inEveryNamespace(store: NamespacedStore | undefined, namespaces: () => string[]) {
  if (!store) return undefined;

  return {
    loadAll: () => {
      const names = namespaces();

      // No namespace known yet: wait for one rather than load an empty list.
      return names.length > 0 ? store.loadAll({ namespaces: names }) : Promise.resolve();
    },
    get isLoaded() {
      return store.isLoaded;
    },
    subscribe: () => store.subscribe(),
  };
}

export function useOtelStores(): OtelStores {
  // Each registers only once its CRD exists; one missing must not hold the other back.
  const instrumentationStore = useKubeStore(() => Instrumentation.getStore<Instrumentation>());
  const collectorStore = useKubeStore(() =>
    OpenTelemetryCollector.getStore<OpenTelemetryCollector>(),
  );
  const scope = useNamespaceScope();
  const key = scopeKey(scope);
  const {
    cronJobStore,
    daemonSetStore,
    deploymentStore,
    jobStore,
    namespaceStore,
    podsStore,
    statefulSetStore,
  } = Renderer.K8sApi;
  const workloadStores = [
    deploymentStore,
    statefulSetStore,
    daemonSetStore,
    cronJobStore,
    jobStore,
  ];
  const namespaces = namespaceStore.items as unknown as NamespaceLike[];
  const everyKey = everywhereKey(namespaceStore.isLoaded, scope);
  // Read at load time, not a dependency: a namespace created or deleted reloads nothing.
  const latest = useRef({ namespaces, scope });

  latest.current = { namespaces, scope };

  const everyNamespaceName = useCallback(
    () =>
      everyNamespace(
        latest.current.namespaces.map((namespace) => namespace.getName()),
        latest.current.scope,
      ),
    [],
  );
  const instrumentationsEverywhere = useMemo(
    () => inEveryNamespace(instrumentationStore, everyNamespaceName),
    [instrumentationStore, everyNamespaceName],
  );
  const collectorsEverywhere = useMemo(
    () => inEveryNamespace(collectorStore, everyNamespaceName),
    [collectorStore, everyNamespaceName],
  );

  const instrumentationsLoad = useLoadedStores([instrumentationsEverywhere], everyKey);
  const collectorsLoad = useLoadedStores([collectorsEverywhere], everyKey);
  const hostLoad = useLoadedStores([...workloadStores, podsStore], key);

  const scoped = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  // The stores are shared: what they hold before this read lands may be another scope's.
  const instrumentations =
    instrumentationStore && instrumentationsLoad.loadedFor === everyKey
      ? (instrumentationStore.items as unknown as InstrumentationLike[])
      : undefined;
  const everyCollector =
    collectorStore && collectorsLoad.loadedFor === everyKey
      ? (collectorStore.items as unknown as CollectorLike[])
      : undefined;
  const collectors = scoped<CollectorLike>(collectorStore);
  const hostLoaded = loadedForScope([...workloadStores, podsStore], hostLoad.loadedFor, key);
  const podsLoaded = loadedForScope([podsStore], hostLoad.loadedFor, key);

  return {
    workloads: workloadStores.flatMap((store) => scoped<WorkloadLike>(store)),
    pods: scoped<PodLike>(podsStore),
    namespaces,
    instrumentations,
    collectors,
    everyCollector,
    gaveUp: {
      instrumentations: !instrumentationStore || instrumentationsLoad.gaveUp,
      collectors: !collectorStore || collectorsLoad.gaveUp,
    },
    scope,
    coverageState: loadState({
      registered: Boolean(instrumentationStore),
      loaded: Boolean(instrumentations) && hostLoaded,
      itemCount: hostLoaded ? (instrumentations?.length ?? 0) : 0,
      gaveUp: instrumentationsLoad.gaveUp || hostLoad.gaveUp,
    }),
    collectorState: loadState({
      registered: Boolean(collectorStore),
      loaded: Boolean(everyCollector) && podsLoaded,
      itemCount: podsLoaded ? (everyCollector?.length ?? 0) : 0,
      gaveUp: collectorsLoad.gaveUp || hostLoad.gaveUp,
    }),
  };
}
