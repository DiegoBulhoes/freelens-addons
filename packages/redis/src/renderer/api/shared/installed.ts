export const CRD_NAMES: readonly string[] = [
  "redis.redis.redis.opstreelabs.in",
  "redisreplications.redis.redis.opstreelabs.in",
  "redisclusters.redis.redis.opstreelabs.in",
  "redissentinels.redis.redis.opstreelabs.in",
];

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}
