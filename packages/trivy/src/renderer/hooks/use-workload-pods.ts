import { Renderer } from "@freelensapp/extensions";
import { useEffect } from "react";

import type { ReportSubject } from "../api/types";
import { describePod, type RunningPod, selectPodsOf, sortPods } from "../api/workload-pods";

const {
  K8sApi: { podsStore },
} = Renderer;

/**
 * The cluster's own pods, which the reports cannot name. Pure store access:
 * which pods belong to a subject is decided in `workload-pods.ts`.
 */
export function useWorkloadPods(subject: ReportSubject): RunningPod[] {
  useEffect(() => {
    // onLoadFailure keeps a refused namespace from emptying a store the rest of
    // Freelens shares: without it the host's loadAll calls resetOnError, which
    // also sets isLoaded false and leaves every open view's watch deaf.
    void podsStore.loadAll({
      namespaces: [subject.namespace],
      onLoadFailure: (error: unknown) =>
        console.warn(`[trivy] could not list pods in ${subject.namespace}`, error),
    });

    return podsStore.subscribe();
  }, [subject.namespace]);

  return sortPods(selectPodsOf(podsStore.items, subject).map(describePod));
}
