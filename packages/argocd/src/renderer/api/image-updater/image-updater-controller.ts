import type { Command } from "../shared/commands";
import type { ImageUpdater } from "./image-updater";

/** Labels from both the controller's own manifest and its Helm chart. */
export const CONTROLLER_SELECTOR =
  "app.kubernetes.io/name in (argocd-image-updater-controller,argocd-image-updater)";

export interface ControllerRef {
  namespace: string;
  name: string;
}

/** The manifest's name; the Helm chart names its Deployment after the release. */
export const DEFAULT_CONTROLLER = "argocd-image-updater-controller";

/** The Deployment found by its labels, or the manifest's name in ArgoCD's namespace. */
export function controllerOf(found: ControllerRef[], fallbackNamespace: string): ControllerRef {
  return found[0] ?? { namespace: fallbackNamespace, name: DEFAULT_CONTROLLER };
}

export function ruleCommands(updater: ImageUpdater, controller: ControllerRef): Command[] {
  const name = updater.getName();
  const namespace = updater.metadata.namespace as string;

  return [
    {
      label: "The rule, as the cluster has it",
      command: `kubectl -n ${namespace} get imageupdater ${name} -o yaml`,
    },
    {
      label: "Its warnings and errors from the controller's log",
      command: `kubectl -n ${controller.namespace} logs deploy/${controller.name} --since=1h | grep 'imageUpdater_name=${name} ' | grep -E 'level=(warning|error)'`,
    },
  ];
}
