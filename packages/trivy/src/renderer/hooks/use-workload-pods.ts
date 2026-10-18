import { Renderer } from "@freelensapp/extensions";

import { POD_KIND } from "../api/shared/kinds";
import type { ReportSubject } from "../api/shared/types";
import {
  describePod,
  type PodListState,
  podListState,
  type RunningPod,
  selectPodsOf,
  sortPods,
} from "../api/workloads/workload-pods";
import { useLoadedStores } from "./load-stores";

const {
  K8sApi: { podsStore },
} = Renderer;

export interface WorkloadPods {
  pods: RunningPod[];
  state: PodListState;
}

// The shared loader subscribes only after the list lands, so the watch starts from its resourceVersion.
export function useWorkloadPods(subject: ReportSubject): WorkloadPods {
  const load = useLoadedStores(
    [{ kind: POD_KIND, namespaced: true, store: podsStore }],
    subject.namespace,
  );

  return {
    pods: sortPods(selectPodsOf(podsStore.items, subject).map(describePod)),
    state: podListState(subject.namespace, POD_KIND, load),
  };
}
