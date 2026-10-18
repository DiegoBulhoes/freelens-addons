import { describe, expect, it } from "vitest";
import { CRD_NAMES, isInstalled } from "../../src/renderer/api/shared/installed";
import { scopeKey, withinScope } from "../../src/renderer/api/shared/namespace-scope";
import {
  describeLoadState,
  emptyText,
  inventoryState,
  loadedForScope,
  loadState,
  worstOf,
} from "../../src/renderer/api/shared/store-state";
import { ago, formatAge } from "../../src/renderer/api/shared/verdict";
import { describeOutcome, failureOf, planFor } from "../../src/renderer/api/writes/bulk";
import { objects } from "../support/fixtures";

describe("installed", () => {
  it("with any of the operator's CRDs", () => {
    expect(isInstalled([CRD_NAMES[2] ?? ""])).toBe(true);
    expect(isInstalled(["redis.example.com"])).toBe(false);
  });
});

describe("bulk", () => {
  it("skips what an action refuses, saying why, and reports the outcome", () => {
    const plan = planFor([1, 2, 3], (n) => (n === 2 ? "even" : undefined));

    expect(plan).toEqual({ ready: [1, 3], skipped: [{ item: 2, reason: "even" }] });
    expect(describeOutcome("Restarted", 2, [])).toBe("Restarted 2 of 2.");
    expect(describeOutcome("Restarted", 1, ["a"])).toBe("Restarted 1 of 2. Failed: a.");
  });

  it("keeps why each one failed, so a half-restarted one reads apart from a skipped one", () => {
    const failed = [
      failureOf("cache", new Error('Stopped before "restart cache-1": Another pod is not ready.')),
      failureOf("sessions", "timed out, then gave up"),
    ];

    expect(describeOutcome("Restarted", 0, failed)).toBe(
      'Restarted 0 of 2. Failed: cache (Stopped before "restart cache-1": Another pod is not ready.); sessions (timed out, then gave up).',
    );
  });
});

describe("scope and load state", () => {
  it("keeps the namespaces in scope", () => {
    expect(withinScope(objects(), ["other"])).toEqual([]);
    expect(withinScope(objects(), ["redis"])).toHaveLength(objects().length);
    expect(scopeKey(["b", "a"])).toBe("a,b");
  });

  it("tells not installed, connecting, unreachable and ready apart", () => {
    const facts = { registered: true, loaded: false, itemCount: 0, gaveUp: false };

    expect(loadState({ ...facts, registered: false })).toBe("not-installed");
    expect(loadState(facts)).toBe("connecting");
    expect(loadState({ ...facts, gaveUp: true })).toBe("unreachable");
    expect(loadState({ ...facts, itemCount: 1 })).toBe("ready");
    expect(describeLoadState("not-installed")).toMatch(/not installed/);
    expect(describeLoadState("connecting")).toMatch(/Connecting/);
    expect(describeLoadState("unreachable")).toMatch(/incomplete/);
    expect(describeLoadState("ready")).toBeUndefined();
  });
});

describe("verdicts and times", () => {
  it("says how long ago", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(72 * 3_600_000)).toBe("3d");
    expect(ago(undefined, 0)).toBe("—");
    expect(ago("nonsense", 0)).toBe("—");
    expect(ago("1970-01-01T00:00:00Z", 600_000)).toBe("10m ago");
  });
});

describe("the state of every list a page reads", () => {
  const loaded = { registered: true, loaded: true, gaveUp: false };
  const absent = { registered: false, loaded: false, gaveUp: false };

  it("counts a store loaded only for the scope its own load completed for", () => {
    expect(loadedForScope([{ isLoaded: true }], "redis", "redis")).toBe(true);
    expect(loadedForScope([{ isLoaded: true }], "other", "redis")).toBe(false);
    expect(loadedForScope([{ isLoaded: true }], undefined, "redis")).toBe(false);
    expect(loadedForScope([{ isLoaded: true }, { isLoaded: false }], "redis", "redis")).toBe(false);
  });

  it("keeps the worst", () => {
    expect(worstOf("ready", "connecting", "unreachable")).toBe("unreachable");
    expect(worstOf("ready", "connecting")).toBe("connecting");
    expect(worstOf()).toBe("ready");
  });

  it("is unreachable when the pods are refused, though every CRD loaded", () => {
    expect(inventoryState([loaded, loaded], { ...loaded, loaded: false, gaveUp: true })).toBe(
      "unreachable",
    );
    expect(inventoryState([loaded, loaded], { ...loaded, loaded: false })).toBe("connecting");
  });

  it("leaves out the CRDs not installed, and fails on any installed one that gave up", () => {
    expect(inventoryState([loaded, absent, absent, absent], loaded)).toBe("ready");
    expect(inventoryState([loaded, { ...loaded, loaded: false, gaveUp: true }], loaded)).toBe(
      "unreachable",
    );
    expect(inventoryState([absent, absent], loaded)).toBe("not-installed");
  });

  it("is unreachable when every namespace refused a list, though the store reads loaded", () => {
    expect(loadState({ ...loaded, itemCount: 3, failed: true })).toBe("unreachable");
    expect(inventoryState([loaded, { ...loaded, failed: true }], loaded)).toBe("unreachable");
    expect(inventoryState([loaded], { ...loaded, loaded: false, failed: true })).toBe(
      "unreachable",
    );
  });

  it("says why a list is empty until it is read", () => {
    expect(emptyText("connecting", "No replications.")).toBe("Connecting to the cluster…");
    expect(emptyText("unreachable", "No replications.")).toBe(
      "Nothing could be read, so nothing is listed.",
    );
    expect(emptyText("ready", "No replications.")).toBe("No replications.");
  });
});
