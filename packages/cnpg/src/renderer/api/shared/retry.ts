const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;
/** A Secret created while the page is open shows within this. */
export const RELIST_MS = 60_000;
/** A drawer's warnings stay this fresh. */
export const WARNINGS_RELIST_MS = 30_000;

/** After `failures` refused reads in a row, 2s doubling up to a minute; with none, the slow re-list. */
export function nextReadDelay(failures: number, settled = RELIST_MS): number {
  if (failures <= 0) return settled;

  return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS);
}
