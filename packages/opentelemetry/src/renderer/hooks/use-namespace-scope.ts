import { Renderer } from "@freelensapp/extensions";

/** Read during render, so an observer component re-renders when it changes. */
export function useNamespaceScope(): readonly string[] {
  return Renderer.K8sApi.namespaceStore.contextNamespaces;
}
