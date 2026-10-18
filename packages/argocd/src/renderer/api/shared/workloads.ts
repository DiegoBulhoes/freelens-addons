import { Renderer } from "@freelensapp/extensions";

import type { Application } from "../applications/application";
import { withTimeout } from "./read-timeout";
import {
  findArgoCDUrlIn,
  namespacesOf,
  type PodListing,
  pickComponentPod,
  selectApplicationPods,
} from "./workload-selection";

const {
  Component: { logTabStore },
  K8sApi: { podsStore, ingressApi },
} = Renderer;

// createWorkloadTab matches pods by direct owner only, so it finds none for a Deployment.

export type Pod = (typeof podsStore.items)[number];

type NamespacedStore = {
  loadAll(params: {
    namespaces: string[];
    reqInit: RequestInit;
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

  try {
    await withTimeout((signal) =>
      store.loadAll({
        namespaces,
        reqInit: { signal },
        onLoadFailure: (error) => {
          unreadableCount += 1;
          console.warn(`[argocd] could not list ${kind} in ${namespaces.join(", ")}`, error);
        },
      }),
    );
  } catch (error) {
    console.warn(`[argocd] no answer listing ${kind} in ${namespaces.join(", ")}`, error);

    return namespaces.length;
  }

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

export async function openComponentLogs(
  component: ArgoCDComponent,
  namespace: string,
): Promise<OpenComponentLogsResult> {
  if ((await listWithRefusalCount(podsStore, "pods", [namespace])) > 0) return "could-not-list";

  const pod = pickComponentPod(podsStore.items, component, namespace);

  if (!pod) return "no-pods";

  return openPodLogs(pod);
}

/** Through the API, not the shared store: the overview must not replace the host's Ingress list. */
export async function findArgoCDUrl(namespace: string): Promise<string | undefined> {
  try {
    const ingresses =
      (await withTimeout((signal) => ingressApi.list({ namespace, reqInit: { signal } }))) ?? [];

    return findArgoCDUrlIn(ingresses, namespace);
  } catch (error) {
    console.warn(`[argocd] could not list ingresses in ${namespace}`, error);

    return undefined;
  }
}
