export const READ_TIMEOUT_MS = 20_000;

/** Rejects after `ms` and aborts the read, so a hung read cannot hold its namespace forever. */
export function withTimeout<T>(
  read: (signal: AbortSignal) => Promise<T>,
  ms = READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`No answer in ${ms / 1000}s`));
    }, ms);
  });

  return Promise.race([read(controller.signal), expired]).finally(() => clearTimeout(timer));
}

export const READ_SLOTS = 6;

/** Promise.allSettled with at most `slots` reads under way, results in the order of `items`. */
export async function settleInSlots<Item, Result>(
  items: readonly Item[],
  read: (item: Item) => Promise<Result>,
  slots = READ_SLOTS,
): Promise<PromiseSettledResult<Result>[]> {
  const results: PromiseSettledResult<Result>[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const at = next++;

      try {
        results[at] = { status: "fulfilled", value: await read(items[at] as Item) };
      } catch (reason) {
        results[at] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(1, slots), items.length) }, worker));

  return results;
}
