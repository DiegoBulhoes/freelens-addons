import { describe, expect, it } from "vitest";

import { scopeKey, withinScope } from "../../src/renderer/api/shared/namespace-scope";
import { serviceMonitors } from "../support/fixtures";

describe("scope and load state", () => {
  it("keeps the namespaces in scope", () => {
    expect(withinScope(serviceMonitors(), ["prom-outside"]).map((each) => each.getName())).toEqual([
      "excluded",
    ]);
    expect(withinScope(serviceMonitors(), ["other"])).toEqual([]);
    expect(scopeKey(["prom-apps", "monitoring"])).toBe("monitoring,prom-apps");
  });
});
