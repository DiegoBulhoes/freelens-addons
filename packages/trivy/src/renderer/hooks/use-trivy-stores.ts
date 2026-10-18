import { Renderer } from "@freelensapp/extensions";
import {
  ConfigAuditReport,
  ExposedSecretReport,
  POD_KIND,
  REPLICA_SET_KIND,
  REPORT_KINDS,
  SbomReport,
  VulnerabilityReport,
} from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import {
  describeGap,
  type Failures,
  type LoadState,
  loadedForScope,
  loadState,
  readableScope,
  unreadIn,
} from "../api/shared/store-state";
import { type ReplicaSetLike, workloadGaps } from "../api/workloads/coverage";
import type { SbomSubject } from "../api/workloads/sbom-metadata";
import type { PodLike } from "../api/workloads/workload-pods";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";
import { useSbomSubjects } from "./use-sbom-subjects";

export interface TrivyStores {
  vulnerabilityReports: VulnerabilityReport[];
  configAuditReports: ConfigAuditReport[];
  sbomReports: SbomSubject[];
  exposedSecretReports: ExposedSecretReport[];
  pods: PodLike[];
  podsUnreadIn: ReadonlySet<string>;
  replicaSets: ReplicaSetLike[];
  replicaSetsUnreadIn: ReadonlySet<string>;
  registered: boolean;
  /** The namespaces read, as one key. */
  scopeKey: string;
  state: LoadState;
  failures: Failures;
  /** What could not be read, for a banner. */
  gaps: string[];
}

export function useTrivyStores(): TrivyStores {
  const vulnerabilityStore = useKubeStore(() =>
    VulnerabilityReport.getStore<VulnerabilityReport>(),
  );
  const configAuditStore = useKubeStore(() => ConfigAuditReport.getStore<ConfigAuditReport>());
  // Only to know the CRD is served: its items are never loaded.
  const sbomRegistered = Boolean(useKubeStore(() => SbomReport.getStore<SbomReport>()));
  const exposedSecretStore = useKubeStore(() =>
    ExposedSecretReport.getStore<ExposedSecretReport>(),
  );
  const { podsStore, replicaSetStore } = Renderer.K8sApi;

  const scope = useNamespaceScope();
  const key = scopeKey(scope);
  const loaded = useLoadedStores(
    [
      { kind: VulnerabilityReport.kind, namespaced: true, store: vulnerabilityStore },
      { kind: ConfigAuditReport.kind, namespaced: true, store: configAuditStore },
      { kind: ExposedSecretReport.kind, namespaced: true, store: exposedSecretStore },
      { kind: POD_KIND, namespaced: true, store: podsStore },
      { kind: REPLICA_SET_KIND, namespaced: true, store: replicaSetStore },
    ],
    key,
  );
  const sbom = useSbomSubjects(sbomRegistered, key);

  const failures = new Map(loaded.failures);

  if (sbom.refusedIn.length > 0) failures.set(SbomReport.kind, new Set(sbom.refusedIn));

  const readable = readableScope(scope, failures, REPORT_KINDS);
  const stores = [
    vulnerabilityStore,
    configAuditStore,
    exposedSecretStore,
    podsStore,
    replicaSetStore,
  ];
  const storesLoaded = loadedForScope(stores, loaded.loadedFor, key);
  const sbomLoaded = !sbomRegistered || sbom.loadedFor === key;

  return {
    vulnerabilityReports: withinScope(
      (vulnerabilityStore?.items ?? []) as VulnerabilityReport[],
      readable,
    ),
    configAuditReports: withinScope(
      (configAuditStore?.items ?? []) as ConfigAuditReport[],
      readable,
    ),
    sbomReports: withinScope(sbom.subjects, readable),
    exposedSecretReports: withinScope(
      (exposedSecretStore?.items ?? []) as ExposedSecretReport[],
      readable,
    ),
    pods: withinScope(podsStore.items as unknown as PodLike[], readable),
    podsUnreadIn: unreadIn(failures, POD_KIND),
    replicaSets: withinScope(replicaSetStore.items as unknown as ReplicaSetLike[], readable),
    replicaSetsUnreadIn: unreadIn(failures, REPLICA_SET_KIND),
    registered: Boolean(vulnerabilityStore),
    scopeKey: key,
    state: loadState({
      loaded: Boolean(vulnerabilityStore) && storesLoaded && sbomLoaded,
      gaveUp: loaded.gaveUp || sbom.gaveUp,
      failures,
      required: REPORT_KINDS.map((kind) => ({ kind, namespaced: true })),
      scope,
    }),
    failures,
    gaps: [
      describeGap(failures, REPORT_KINDS, "Those namespaces are left out of the counts and lists."),
      ...workloadGaps(failures),
    ].filter((gap) => gap !== undefined),
  };
}
