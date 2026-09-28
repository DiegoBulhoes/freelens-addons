/**
 * Whether the cluster has ArgoCD, judged from the names of its
 * CustomResourceDefinitions. The sidebar group is shown only when it does: on
 * a cluster without ArgoCD, every page could only say there is nothing to show.
 */
export const CRD_NAMES: readonly string[] = ["applications.argoproj.io"];

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}
