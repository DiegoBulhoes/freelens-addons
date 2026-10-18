import { afterEach, describe, expect, it, vi } from "vitest";

import { HOST_LIST_TITLES, hostListOf } from "../../src/renderer/api/shared/host-links";
import { dueReads, FRESH_MS, MAX_READS } from "../../src/renderer/api/shared/polling";
import { READ_TIMEOUT_MS, withTimeout } from "../../src/renderer/api/shared/read-timeout";
import { nextReadDelay, RELIST_MS } from "../../src/renderer/api/shared/retry";
import {
  afterLoad,
  describeLoadState,
  EVERYWHERE,
  emptyText,
  failedAmong,
  failedNamespacesOf,
  loadedForScope,
  loadState,
  MAX_LOAD_ATTEMPTS,
  worstOf,
} from "../../src/renderer/api/shared/store-state";

// Template only: an extension tests these on its own fixtures, beside its own verdicts.
afterEach(() => {
  vi.useRealTimers();
});

// As the API server words a refused list.
const refusedIn = (namespace: string) =>
  new Error(
    `pods is forbidden: User "viewer" cannot list resource "pods" in API group "" in the namespace "${namespace}"`,
  );

describe("a list refused in some namespace", () => {
  it("names the namespace Kubernetes refused, and counts any other failure against every one", () => {
    expect(failedNamespacesOf(refusedIn("b"), ["a", "b"])).toEqual(["b"]);
    expect(
      failedNamespacesOf(new Error("list failed", { cause: refusedIn("a") }), ["a", "b"]),
    ).toEqual(["a"]);
    expect(failedNamespacesOf(new Error("socket hang up"), ["a", "b"])).toEqual(["a", "b"]);
    expect(failedNamespacesOf(refusedIn("elsewhere"), ["b"])).toEqual(["b"]);
    expect(failedNamespacesOf("timeout", [])).toEqual([EVERYWHERE]);
    expect(failedNamespacesOf(undefined, ["b"])).toEqual(["b"]);
  });

  it("survives an error whose cause is itself", () => {
    const looped = new Error("looped") as Error & { cause?: unknown };

    looped.cause = looped;

    expect(failedNamespacesOf(looped, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("is listed again until every namespace answers or the attempts run out", () => {
    expect(afterLoad({ loaded: true, failed: 0, attempts: 1 })).toBe("done");
    expect(afterLoad({ loaded: true, failed: 1, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: false, failed: 0, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: true, failed: 1, attempts: MAX_LOAD_ATTEMPTS })).toBe("give-up");
  });

  it("counts only where something of ours lives, or a refusal everywhere", () => {
    expect(failedAmong(new Set(["kube-system"]), ["a"])).toBe(false);
    expect(failedAmong(new Set(["a"]), ["a"])).toBe(true);
    expect(failedAmong(new Set([EVERYWHERE]), ["a"])).toBe(true);
  });
});

describe("a page's load state", () => {
  const facts = { registered: true, loaded: true, itemCount: 3, gaveUp: false };

  it("reads as unreachable, not ready, though the host marks a refused list loaded", () => {
    expect(loadState(facts)).toBe("ready");
    expect(loadState({ ...facts, failed: true })).toBe("unreachable");
    expect(loadState({ ...facts, registered: false, failed: true })).toBe("not-installed");
  });

  it("connects until the attempts run out, unless items already arrived", () => {
    const empty = { ...facts, loaded: false, itemCount: 0 };

    expect(loadState(empty)).toBe("connecting");
    expect(loadState({ ...empty, gaveUp: true })).toBe("unreachable");
    expect(loadState({ ...empty, gaveUp: true, itemCount: 1 })).toBe("ready");
  });

  it("is as bad as the worst list the page stands on", () => {
    expect(worstOf("ready", "connecting")).toBe("connecting");
    expect(worstOf("connecting", "unreachable")).toBe("unreachable");
    expect(worstOf()).toBe("ready");
  });

  it("trusts a store only once it loaded for the scope asked", () => {
    expect(loadedForScope([{ isLoaded: true }], "a", "a")).toBe(true);
    expect(loadedForScope([{ isLoaded: true }], "a", "a,b")).toBe(false);
    expect(loadedForScope([{ isLoaded: false }], "a", "a")).toBe(false);
  });

  it("says why a list is empty before it says there is nothing", () => {
    expect(emptyText("connecting", "None.")).toBe("Connecting to the cluster…");
    expect(emptyText("ready", "None.")).toBe("None.");
    expect(describeLoadState("not-installed")).toMatch(/not installed/);
    expect(describeLoadState("unreachable")).toMatch(/incomplete/);
  });
});

describe("polling", () => {
  it("reads at most a few at once, and none already under way or still fresh", () => {
    const keys = Array.from({ length: MAX_READS + 3 }, (_, at) => `k${at}`);
    const [first = "", second = "", third = ""] = [...keys].sort();
    const reads = new Map([
      [first, { inFlight: true }],
      [second, { at: 1000 }],
      [third, { at: 1000 - FRESH_MS }],
    ]);
    const due = dueReads([...keys, first], reads, 1000, 0);

    expect(due).toHaveLength(MAX_READS);
    expect(due).not.toContain(first);
    expect(due).not.toContain(second);
    expect(due).toContain(third);
    expect(dueReads(keys, new Map(), 0, MAX_READS - 2)).toHaveLength(2);
    expect(dueReads(keys, new Map(), 0, MAX_READS + 1)).toEqual([]);
  });

  it("retries a refused read sooner, doubling up to a minute, and re-lists slowly once it answers", () => {
    expect(nextReadDelay(0)).toBe(RELIST_MS);
    expect(nextReadDelay(1)).toBe(2_000);
    expect(nextReadDelay(3)).toBe(8_000);
    expect(nextReadDelay(20)).toBe(60_000);
  });
});

describe("a read with a timeout", () => {
  it("gives up on a read that never answers, and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = withTimeout((given) => {
      signal = given;

      return new Promise<never>(() => {});
    });
    const outcome = expect(read).rejects.toThrow("No answer in 20s");

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });

  it("keeps an answer that comes in time, and leaves no timer behind", async () => {
    vi.useFakeTimers();

    await expect(withTimeout(async () => "listed")).resolves.toBe("listed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a link to a host list", () => {
  it("opens the list searched by the name, since a page of ours cannot open the host's drawer", () => {
    expect(hostListOf("Pod", "web-0")).toBe("/pods?search=web-0");
    expect(hostListOf("Secret", "a b")).toBe("/secrets?search=a%20b");
    expect(HOST_LIST_TITLES.Secret).toMatch(/Secrets list/);
  });
});
