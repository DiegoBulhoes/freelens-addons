// A page of clusters must not exec into every member at once.
export const MAX_READS = 8;
export const FRESH_MS = 15_000;

/** What a poll needs of a key's last read: when it ended, and whether one is under way. */
export interface Polled {
  at?: number;
  inFlight?: boolean;
}

/** The keys to read now: never read or stale, not already under way, and no more than the free slots. */
export function dueReads(
  keys: readonly string[],
  reads: ReadonlyMap<string, Polled>,
  now: number,
  inFlight: number,
  freshMs = FRESH_MS,
): string[] {
  return [...new Set(keys)]
    .sort()
    .filter((key) => {
      const read = reads.get(key);

      if (!read) return true;
      if (read.inFlight) return false;

      return read.at === undefined || now - read.at >= freshMs;
    })
    .slice(0, Math.max(0, MAX_READS - inFlight));
}
