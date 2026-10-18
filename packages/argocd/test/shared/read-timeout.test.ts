import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DIALOG_READ_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  withTimeout,
} from "../../src/renderer/api/shared/read-timeout";
import { applications } from "../support/fixtures";

const hung = () => new Promise<never>(() => {});

afterEach(() => {
  vi.useRealTimers();
});

describe("a read with a timeout", () => {
  it("gives up on a read that never answers, and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = withTimeout((given) => {
      signal = given;

      return hung();
    });
    const outcome = expect(read).rejects.toThrow("No answer in 20s");

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });

  it("waits less for a read a confirmation stands on", async () => {
    vi.useFakeTimers();
    const outcome = expect(withTimeout(hung, DIALOG_READ_TIMEOUT_MS)).rejects.toThrow(
      "No answer in 5s",
    );

    await vi.advanceTimersByTimeAsync(DIALOG_READ_TIMEOUT_MS);
    await outcome;
  });

  it("keeps an answer that comes in time, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const listed = applications();

    await expect(withTimeout(async () => listed)).resolves.toBe(listed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes a refusal on as it is", async () => {
    await expect(
      withTimeout(() => Promise.reject(new Error("applications.argoproj.io is forbidden"))),
    ).rejects.toThrow("forbidden");
  });
});
