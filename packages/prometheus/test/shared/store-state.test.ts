import { describe, expect, it } from "vitest";

import {
  describeLoadState,
  loadedForScope,
  loadState,
} from "../../src/renderer/api/shared/store-state";

describe("scope and load state", () => {
  it("tells not installed, connecting, unreachable and ready apart", () => {
    const facts = { registered: true, loaded: false, itemCount: 0, gaveUp: false };

    expect(loadState({ ...facts, registered: false })).toBe("not-installed");
    expect(loadState(facts)).toBe("connecting");
    expect(loadState({ ...facts, gaveUp: true })).toBe("unreachable");
    expect(loadState({ ...facts, itemCount: 1 })).toBe("ready");
    expect(describeLoadState("not-installed")).toMatch(/Prometheus Operator is not installed/);
    expect(describeLoadState("connecting")).toMatch(/Connecting/);
    expect(describeLoadState("unreachable")).toMatch(/incomplete/);
    expect(describeLoadState("ready")).toBeUndefined();
  });
});

describe("stores loaded for a scope", () => {
  it("wait until the load for this scope ends, not only any load", () => {
    const scope = "monitoring,prom-apps";

    expect(loadedForScope([{ isLoaded: true, loadedFor: "monitoring" }], scope)).toBe(false);
    expect(loadedForScope([{ isLoaded: true }], scope)).toBe(false);
    expect(loadedForScope([{ isLoaded: false, loadedFor: scope }], scope)).toBe(false);
    expect(
      loadedForScope(
        [
          { isLoaded: true, loadedFor: scope },
          { isLoaded: true, loadedFor: scope },
        ],
        scope,
      ),
    ).toBe(true);
    expect(loadedForScope([{ isLoaded: false }], "")).toBe(true);
  });
});
