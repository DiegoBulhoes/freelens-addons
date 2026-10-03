import { describe, expect, it } from "vitest";

import { scopeKey, withinScope } from "../src/renderer/api/namespace-scope";
import { applications, imageUpdaters } from "./fixtures";

describe("what the namespace selector leaves on a page", () => {
  it("keeps what lives in a chosen namespace", () => {
    const all = applications();

    expect(withinScope(all, ["argocd"])).toHaveLength(
      all.filter((application) => application.getNs() === "argocd").length,
    );
    expect(withinScope(imageUpdaters(), ["argocd"])).toHaveLength(imageUpdaters().length);
  });

  it("keeps nothing for a namespace that holds nothing of it", () => {
    expect(withinScope(applications(), ["default"])).toEqual([]);
    expect(withinScope(applications(), [])).toEqual([]);
  });

  it("names a scope the same way whatever order it was picked in", () => {
    expect(scopeKey(["demo", "argocd"])).toBe(scopeKey(["argocd", "demo"]));
    expect(scopeKey(["argocd"])).not.toBe(scopeKey(["argocd", "demo"]));
  });
});
