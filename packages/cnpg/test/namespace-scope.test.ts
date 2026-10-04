import { describe, expect, it } from "vitest";

import { scopeKey, withinScope } from "../src/renderer/api/namespace-scope";
import { clusters, poolers } from "./fixtures";

describe("what the namespace selector leaves on a page", () => {
  it("keeps what lives in a chosen namespace", () => {
    const all = clusters();

    expect(all.length).toBeGreaterThan(0);
    expect(withinScope(all, ["databases"])).toHaveLength(all.length);
  });

  it("keeps nothing for a namespace that holds none of it", () => {
    expect(withinScope(clusters(), ["default"])).toEqual([]);
    expect(withinScope(poolers(), [])).toEqual([]);
  });

  it("gives the same key for the same namespaces in any order", () => {
    expect(scopeKey(["b", "a"])).toBe(scopeKey(["a", "b"]));
    expect(scopeKey(["a"])).not.toBe(scopeKey(["a", "b"]));
  });
});
