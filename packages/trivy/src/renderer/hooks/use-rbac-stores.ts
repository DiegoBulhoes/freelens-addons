import {
  CLUSTER_ROLE_REPORTS,
  RBAC_REQUIRED,
  type RbacReport,
  ROLE_REPORTS,
  rbacGaps,
} from "../api/rbac/rbac";
import { ClusterRbacAssessmentReport, RbacAssessmentReport } from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import {
  type Failures,
  type LoadState,
  loadedForScope,
  loadState,
  readableScope,
} from "../api/shared/store-state";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface RbacStores {
  reports: RbacReport[];
  registered: boolean;
  state: LoadState;
  failures: Failures;
  gaps: string[];
}

// ClusterRoles reach every namespace, so they ignore the selector.
export function useRbacStores(): RbacStores {
  const namespaced = useKubeStore(() => RbacAssessmentReport.getStore<RbacAssessmentReport>());
  const clusterWide = useKubeStore(() =>
    ClusterRbacAssessmentReport.getStore<ClusterRbacAssessmentReport>(),
  );

  const scope = useNamespaceScope();
  const key = scopeKey(scope);
  const loaded = useLoadedStores(
    [
      { ...ROLE_REPORTS, store: namespaced },
      { ...CLUSTER_ROLE_REPORTS, store: clusterWide },
    ],
    key,
  );
  const readable = readableScope(scope, loaded.failures, [ROLE_REPORTS.kind]);

  return {
    reports: withinScope(
      [
        ...((namespaced?.items ?? []) as RbacAssessmentReport[]),
        ...((clusterWide?.items ?? []) as ClusterRbacAssessmentReport[]),
      ],
      readable,
    ),
    registered: Boolean(namespaced ?? clusterWide),
    state: loadState({
      loaded: loadedForScope([namespaced, clusterWide], loaded.loadedFor, key),
      gaveUp: loaded.gaveUp,
      failures: loaded.failures,
      required: RBAC_REQUIRED,
      scope,
    }),
    failures: loaded.failures,
    gaps: rbacGaps(loaded.failures),
  };
}
