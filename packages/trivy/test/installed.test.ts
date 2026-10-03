import { describe, expect, it } from "vitest";

import { CRD_NAMES, isInstalled } from "../src/renderer/api/installed";

describe("whether the Trivy operator is installed", () => {
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
