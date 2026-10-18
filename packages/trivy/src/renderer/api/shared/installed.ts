// Any one CRD is enough: report kinds can be turned off.
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
