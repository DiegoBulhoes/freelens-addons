import { describe, expect, it } from "vitest";

import { describeOutcome, planFor } from "../src/renderer/api/bulk";
import { CRD_NAMES, isInstalled } from "../src/renderer/api/installed";
import { scopeKey, withinScope } from "../src/renderer/api/namespace-scope";
import { describeLoadState, loadState } from "../src/renderer/api/store-state";
import { ago, formatAge, worse } from "../src/renderer/api/verdict";
import { objects } from "./fixtures";

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
  it("keeps the worse of two, and says how long ago", () => {
    const ok = { tone: "ok" as const, label: "a", reason: "" };
    const bad = { tone: "critical" as const, label: "b", reason: "" };

    expect(worse(ok, bad)).toBe(bad);
    expect(worse(bad, ok)).toBe(bad);
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(72 * 3_600_000)).toBe("3d");
    expect(ago(undefined, 0)).toBe("—");
    expect(ago("nonsense", 0)).toBe("—");
    expect(ago("1970-01-01T00:00:00Z", 600_000)).toBe("10m ago");
  });
});
