import { scopeKey, withinScope } from "../api/namespace-scope";
import type { RbacReport } from "../api/rbac";
import { ClusterRbacAssessmentReport, RbacAssessmentReport } from "../api/reports";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

// ClusterRoles reach every namespace, so they ignore the selector.
export function useRbacStores(): { reports: RbacReport[]; isReady: boolean; gaveUp: boolean } {
  const namespaced = useKubeStore(() => RbacAssessmentReport.getStore<RbacAssessmentReport>());
  const clusterWide = useKubeStore(() =>
    ClusterRbacAssessmentReport.getStore<ClusterRbacAssessmentReport>(),
  );

  const scope = useNamespaceScope();
  const gaveUp = useLoadedStores([namespaced, clusterWide], scopeKey(scope), "RBAC assessments");

  return {
    reports: withinScope(
      [
        ...((namespaced?.items ?? []) as RbacAssessmentReport[]),
        ...((clusterWide?.items ?? []) as ClusterRbacAssessmentReport[]),
      ],
      scope,
    ),
    isReady: Boolean(namespaced ?? clusterWide),
    gaveUp,
  };
}
