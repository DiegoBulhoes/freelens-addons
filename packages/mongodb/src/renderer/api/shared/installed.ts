export const CRD_NAME = "mongodbcommunity.mongodbcommunity.mongodb.com";

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (name === CRD_NAME) return true;
  }

  return false;
}
