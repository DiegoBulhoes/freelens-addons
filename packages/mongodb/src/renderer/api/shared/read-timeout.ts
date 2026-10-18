export const READ_TIMEOUT_MS = 20_000;

/** Rejects after `ms` and aborts the read, so one that hangs holds back nothing waiting on it. */
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
