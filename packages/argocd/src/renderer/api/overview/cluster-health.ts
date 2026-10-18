import { Renderer } from "@freelensapp/extensions";

import type { LoadableStore } from "../../hooks/load-stores";
import { withTimeout } from "../shared/read-timeout";
import { type ClusterPressure, getPressure, NODE_WARNINGS } from "./pressure";

const {
  K8sApi: { eventApi, nodesStore },
} = Renderer;

export type { ClusterPressure } from "./pressure";

export type NodeEvent = Parameters<typeof getPressure>[1][number];

/** Loaded on every mount and then watched; a refusal reaches onLoadFailure and keeps the shared store. */
export const PRESSURE_STORES: { kind: string; store: LoadableStore }[] = [
  {
    kind: "Node",
    store: {
      loadAll: ({ onLoadFailure }) => nodesStore.loadAll({ onLoadFailure }),
      get isLoaded() {
        return nodesStore.isLoaded;
      },
      subscribe: () => nodesStore.subscribe(),
    },
  },
];

/** Node events live in default; read by field selector because the shared eventStore caps at 1000 of every kind. */
export async function listNodeWarnings(): Promise<NodeEvent[]> {
  try {
    return (
      (await withTimeout((signal) =>
        eventApi.list(
          { namespace: NODE_WARNINGS.namespace, reqInit: { signal } },
          { fieldSelector: NODE_WARNINGS.fieldSelector },
        ),
      )) ?? []
    );
  } catch (error) {
    // A scoped kubeconfig may not read events; the node conditions still show.
    console.warn("[argocd] could not list node warnings", error);

    return [];
  }
}

export function getClusterPressure(events: NodeEvent[], now: number): ClusterPressure[] {
  return getPressure(nodesStore.items, events, now);
}
