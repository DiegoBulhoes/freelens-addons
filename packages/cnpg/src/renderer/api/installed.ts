export const CRD_NAMES: readonly string[] = ["clusters.postgresql.cnpg.io"];

export const OBJECT_STORE_CRD = "objectstores.barmancloud.cnpg.io";

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}

export function hasObjectStores(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (name === OBJECT_STORE_CRD) return true;
  }

  return false;
}
