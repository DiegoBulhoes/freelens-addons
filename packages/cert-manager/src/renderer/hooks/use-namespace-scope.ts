import { Renderer } from "@freelensapp/extensions";

// Read during render, so an observer re-renders when the selection changes.
export function useNamespaceScope(): readonly string[] {
  return Renderer.K8sApi.namespaceStore.contextNamespaces;
}
