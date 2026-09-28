import { Renderer } from "@freelensapp/extensions";

import { type ClusterPressure, getPressure } from "./pressure";

const {
  K8sApi: { eventStore, nodesStore },
} = Renderer;

export type { ClusterPressure } from "./pressure";

export async function loadNodes(): Promise<void> {
  // A scoped-down kubeconfig may read neither, and the correlation is then simply not offered. The
  // callback keeps a refusal from clearing stores the Nodes and Events pages share, and replaces
  // two catches that could never run, loadAll having no rejecting path.
  const noteFailure = (error: unknown) =>
    console.warn("[argocd] could not load cluster health", error);

  if (nodesStore.items.length === 0) await nodesStore.loadAll({ onLoadFailure: noteFailure });

  // Node events are namespaced to `default` wherever the workload lives, a node having no
  // namespace of its own.
  if (eventStore.items.length === 0) {
    await eventStore.loadAll({ namespaces: ["default"], onLoadFailure: noteFailure });
  }
}

export function getClusterPressure(): ClusterPressure[] {
  return getPressure(nodesStore.items, eventStore.items);
}
