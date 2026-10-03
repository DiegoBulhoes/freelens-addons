import { Renderer } from "@freelensapp/extensions";
import { useEffect } from "react";

import type { ReportSubject } from "../api/types";
import { describePod, type RunningPod, selectPodsOf, sortPods } from "../api/workload-pods";

const {
  K8sApi: { podsStore },
} = Renderer;

export function useWorkloadPods(subject: ReportSubject): RunningPod[] {
  useEffect(() => {
    // Without onLoadFailure the host's resetOnError empties the shared store and deafens its watches.
    void podsStore.loadAll({
      namespaces: [subject.namespace],
      onLoadFailure: (error: unknown) =>
        console.warn(`[trivy] could not list pods in ${subject.namespace}`, error),
    });

    return podsStore.subscribe();
  }, [subject.namespace]);

  return sortPods(selectPodsOf(podsStore.items, subject).map(describePod));
}
