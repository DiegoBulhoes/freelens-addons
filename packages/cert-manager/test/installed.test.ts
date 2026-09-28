import { describe, expect, it } from "vitest";

import { CRD_NAMES, isInstalled } from "../src/renderer/api/installed";

/**
 * Whether the sidebar group shows. Wrong one way, the group sits on every
 * cluster with pages that can only say there is nothing there; wrong the other,
 * it vanishes from the one cluster it was installed for.
 */
describe("whether cert-manager is installed", () => {
  it.each(CRD_NAMES)("counts it installed when %s is there, among others", (name) => {
    expect(isInstalled(["applications.argoproj.io", name, "widgets.example.test"])).toBe(true);
  });

  it("does not when the cluster has no CRDs at all", () => {
    expect(isInstalled([])).toBe(false);
  });

  it("does not for another operator's CRDs, or a name that only looks like one", () => {
    expect(isInstalled(["applications.argoproj.io", "widgets.example.test"])).toBe(false);
    expect(isInstalled(CRD_NAMES.map((name) => name.toUpperCase()))).toBe(false);
    expect(isInstalled(CRD_NAMES.map((name) => name.split(".")[0] ?? name))).toBe(false);
  });
});
