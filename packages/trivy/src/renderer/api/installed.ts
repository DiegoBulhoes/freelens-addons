/**
 * Whether the cluster has the Trivy operator, judged from the names of its
 * CustomResourceDefinitions. The sidebar group is shown only when it does: on
 * a cluster without the Trivy operator, every page could only say there is nothing to show. Any one of them is enough: the operator can be installed with some
 * report kinds turned off.
 */
export const CRD_NAMES: readonly string[] = [
  "vulnerabilityreports.aquasecurity.github.io",
  "configauditreports.aquasecurity.github.io",
  "sbomreports.aquasecurity.github.io",
  "exposedsecretreports.aquasecurity.github.io",
  "rbacassessmentreports.aquasecurity.github.io",
  "clusterrbacassessmentreports.aquasecurity.github.io",
];

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}
