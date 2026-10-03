import { Renderer } from "@freelensapp/extensions";

import { type ClusterPressure, getPressure } from "./pressure";

const {
  K8sApi: { eventStore, nodesStore },
} = Renderer;

export type { ClusterPressure } from "./pressure";

export async function loadNodes(): Promise<void> {
  // A scoped kubeconfig may read neither; the callback keeps a refusal from clearing shared stores.
  const noteFailure = (error: unknown) =>
    console.warn("[argocd] could not load cluster health", error);

  if (nodesStore.items.length === 0) await nodesStore.loadAll({ onLoadFailure: noteFailure });

  // Node events land in `default`, a node having no namespace.
  if (eventStore.items.length === 0) {
    await eventStore.loadAll({ namespaces: ["default"], onLoadFailure: noteFailure });
  }
}

export function getClusterPressure(): ClusterPressure[] {
  return getPressure(nodesStore.items, eventStore.items);
}
