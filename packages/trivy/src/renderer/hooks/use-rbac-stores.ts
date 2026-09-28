import { useEffect } from "react";

import type { RbacReport } from "../api/rbac";
import { ClusterRbacAssessmentReport, RbacAssessmentReport } from "../api/reports";
import { useKubeStore } from "../components/use-kube-store";

/** Both kinds together: a Role and a ClusterRole are the same question at two scopes. */
export function useRbacStores(): { reports: RbacReport[]; isReady: boolean } {
  const namespaced = useKubeStore(() => RbacAssessmentReport.getStore<RbacAssessmentReport>());
  const clusterWide = useKubeStore(() =>
    ClusterRbacAssessmentReport.getStore<ClusterRbacAssessmentReport>(),
  );

  useEffect(() => {
    const stores = [namespaced, clusterWide].filter((store) => store !== undefined);

    if (stores.length === 0) return;

    // onLoadFailure keeps a refused namespace from emptying a store shared with
    // the rest of Freelens; without it loadAll calls resetOnError.
    for (const store of stores) {
      void store.loadAll({
        onLoadFailure: (error: unknown) =>
          console.warn("[trivy] could not load RBAC assessments", error),
      });
    }

    const unsubscribers = stores.map((store) => store.subscribe());

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [namespaced, clusterWide]);

  return {
    reports: [
      ...((namespaced?.items ?? []) as RbacReport[]),
      ...((clusterWide?.items ?? []) as RbacReport[]),
    ],
    isReady: Boolean(namespaced ?? clusterWide),
  };
}
