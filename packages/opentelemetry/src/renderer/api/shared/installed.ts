// The two kinds the pages read; the release also installs opampbridges and targetallocators.
export const CRD_NAMES: readonly string[] = [
  "instrumentations.opentelemetry.io",
  "opentelemetrycollectors.opentelemetry.io",
];

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}
