import { afterEach, describe, expect, it, vi } from "vitest";

import { READ_TIMEOUT_MS, withTimeout } from "../../src/renderer/api/shared/read-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("a read that may hang", () => {
  it("answers as the read does when it answers in time", async () => {
    await expect(withTimeout(async () => "events")).resolves.toBe("events");
    await expect(
      withTimeout(async () => {
        throw new Error("events is forbidden");
      }),
    ).rejects.toThrow("events is forbidden");
  });

  it("gives up and aborts the read once the time is up", async () => {
    vi.useFakeTimers();

    let signal: AbortSignal | undefined;
    const read = withTimeout((given) => {
      signal = given;

      return new Promise<never>(() => undefined);
    });
    const outcome = expect(read).rejects.toThrow(`No answer in ${READ_TIMEOUT_MS / 1000}s`);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });
});
