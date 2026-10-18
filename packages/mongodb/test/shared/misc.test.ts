import { describe, expect, it } from "vitest";
import { CRD_NAME, isInstalled } from "../../src/renderer/api/shared/installed";
import { scopeKey, withinScope } from "../../src/renderer/api/shared/namespace-scope";
import { describeLoadState, loadState } from "../../src/renderer/api/shared/store-state";
import { ago, formatAge } from "../../src/renderer/api/shared/verdict";
import { describeOutcome, planFor } from "../../src/renderer/api/writes/bulk";
import { rollingRestartRefusal } from "../../src/renderer/api/writes/operations";
import { replicaSets } from "../support/fixtures";

describe("installed", () => {
  it("only with the MongoDBCommunity CRD", () => {
    expect(isInstalled([CRD_NAME])).toBe(true);
    expect(isInstalled(["mongodb.com_mongodb"])).toBe(false);
  });
});

describe("bulk actions", () => {
  it("skips what an action refuses, saying why", () => {
    const plan = planFor(replicaSets(), rollingRestartRefusal);

    expect(plan.ready.map((each) => each.getName())).toContain("catalog-rs");
    expect(plan.skipped.find((each) => each.item.getName() === "legacy-rs")?.reason).toMatch(
      /not running/,
    );
  });

  it("reports what was done and what failed", () => {
    expect(describeOutcome("Restarted", 2, [])).toBe("Restarted 2 of 2.");
    expect(describeOutcome("Deleted", 1, ["a"])).toBe("Deleted 1 of 2. Failed: a.");
  });
});

describe("scope and load state", () => {
  it("keeps the namespaces in scope", () => {
    expect(withinScope(replicaSets(), ["other"])).toEqual([]);
    expect(withinScope(replicaSets(), ["mongodb", "mongodb-apps"])).toHaveLength(
      replicaSets().length,
    );
    expect(withinScope(replicaSets(), ["mongodb-apps"]).map((rs) => rs.getName())).toEqual([
      "orders-rs",
    ]);
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
    expect(ago("1970-01-01T00:00:00Z", 10_000)).toBe("just now");
    expect(ago("1970-01-01T00:00:00Z", 600_000)).toBe("10m ago");
  });
});
