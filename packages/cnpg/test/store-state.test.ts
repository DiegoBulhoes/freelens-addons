import { describe, expect, it } from "vitest";

import { describeLoadState, loadState } from "../src/renderer/api/store-state";

const base = { registered: true, loaded: false, itemCount: 0, gaveUp: false };

describe("what the pages know about their stores", () => {
  it("is not installed until the API is registered", () => {
    expect(loadState({ ...base, registered: false, loaded: true })).toBe("not-installed");
  });

  it("is ready once loaded, or once anything arrived", () => {
    expect(loadState({ ...base, loaded: true })).toBe("ready");
    expect(loadState({ ...base, itemCount: 2, gaveUp: true })).toBe("ready");
  });

  it("is connecting until the retries give up, then unreachable", () => {
    expect(loadState(base)).toBe("connecting");
    expect(loadState({ ...base, gaveUp: true })).toBe("unreachable");
  });

  it("says nothing when ready, and why otherwise", () => {
    expect(describeLoadState("ready")).toBeUndefined();
    expect(describeLoadState("not-installed")).toContain("not installed");
    expect(describeLoadState("connecting")).toContain("Connecting");
    expect(describeLoadState("unreachable")).toContain("incomplete");
  });
});
