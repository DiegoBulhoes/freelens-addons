// 15 x 2s = 30s: has to outlast a slow cluster connection.
export const MAX_LOAD_ATTEMPTS = 15;
export const RETRY_DELAY_MS = 2000;
// An SBOM written by a rescan shows within this.
export const RELIST_MS = 60_000;

export function hasGivenUp(failures: number): boolean {
  return failures >= MAX_LOAD_ATTEMPTS;
}

/** Soon while a read is refused, slowly once it answers or has been given up on. */
export function nextListDelay(failures: number): number {
  return failures > 0 && !hasGivenUp(failures) ? RETRY_DELAY_MS : RELIST_MS;
}
