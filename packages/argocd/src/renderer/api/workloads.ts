import { Renderer } from "@freelensapp/extensions";

import type { Application } from "./application";
import {
  findArgoCDUrlIn,
  namespacesOf,
  type PodListing,
  selectApplicationPods,
} from "./workload-selection";

const {
  Component: { logTabStore },
  K8sApi: { podsStore, ingressStore },
} = Renderer;

// createWorkloadTab matches pods by direct owner only, so it finds none for a Deployment.

export type Pod = (typeof podsStore.items)[number];

type NamespacedStore = {
  loadAll(params: {
    namespaces: string[];
    onLoadFailure: (error: unknown) => void;
  }): Promise<unknown>;
};

// Without `onLoadFailure`, one refused namespace makes the host empty this shared store.
// One call for all namespaces: `loadItems` overwrites `loadedNamespaces`, which the watch reads.
async function listWithRefusalCount(
  store: NamespacedStore,
  kind: string,
  namespaces: string[],
): Promise<number> {
  let unreadableCount = 0;

  await store.loadAll({
    namespaces,
    onLoadFailure: (error) => {
      unreadableCount += 1;
      console.warn(`[argocd] could not list ${kind} in ${namespaces.join(", ")}`, error);
    },
  });

  return unreadableCount;
}

export interface PodLookup {
  pods: Pod[];
  listing: PodListing;
}

export async function getApplicationPods(application: Application): Promise<PodLookup> {
  const namespaces = namespacesOf(application);

  if (namespaces.length === 0) {
    return { pods: [], listing: { requestedNamespaces: [], unreadableCount: 0 } };
  }

  const unreadableCount = await listWithRefusalCount(podsStore, "pods", namespaces);

  // From the store, not loadAll's result: the caller opens pods[0] of a name-sorted list.
  return {
    pods: selectApplicationPods(podsStore.items, application),
    listing: { requestedNamespaces: namespaces, unreadableCount },
  };
}

export type OpenLogsResult = "opened" | "no-pods";
export type OpenComponentLogsResult = OpenLogsResult | "could-not-list";

export function openPodLogs(pod: Pod): OpenLogsResult {
  const containers = pod.getContainers();

  if (containers.length === 0) return "no-pods";

  logTabStore.createPodTab({
    selectedPod: pod,
    selectedContainer: containers[0] as (typeof containers)[number],
  });

  return "opened";
}

export const ARGOCD_COMPONENTS = [
  "argocd-application-controller",
  "argocd-repo-server",
  "argocd-applicationset-controller",
  "argocd-server",
] as const;

export type ArgoCDComponent = (typeof ARGOCD_COMPONENTS)[number];

export function controllerNamespaceOf(applications: { getNs(): string | undefined }[]): string {
  return applications[0]?.getNs() ?? "argocd";
}

export async function openComponentLogs(
  component: ArgoCDComponent,
  namespace: string,
): Promise<OpenComponentLogsResult> {
  if ((await listWithRefusalCount(podsStore, "pods", [namespace])) > 0) return "could-not-list";

  const pod = podsStore.items.find(
    (candidate) =>
      candidate.getNs() === namespace &&
      (candidate.getLabels().includes(`app.kubernetes.io/name=${component}`) ||
        candidate.getName().startsWith(component)),
  );

  if (!pod) return "no-pods";

  return openPodLogs(pod);
}

export async function findArgoCDUrl(namespace: string): Promise<string | undefined> {
  await listWithRefusalCount(ingressStore, "ingresses", [namespace]);

  return findArgoCDUrlIn(ingressStore.items, namespace);
}
