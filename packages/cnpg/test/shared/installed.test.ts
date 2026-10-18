import { describe, expect, it } from "vitest";

import { CRD_NAMES, isInstalled } from "../../src/renderer/api/shared/installed";

describe("whether CloudNativePG is installed", () => {
  it.each(CRD_NAMES)("counts it installed when %s is there, among others", (name) => {
    expect(isInstalled(["applications.argoproj.io", name])).toBe(true);
  });

  it("does not without its CRDs, or for a name that only looks like one", () => {
    expect(isInstalled([])).toBe(false);
    expect(isInstalled(["clusters.example.test", "backups.postgresql.cnpg.io"])).toBe(false);
    expect(isInstalled(CRD_NAMES.map((name) => name.toUpperCase()))).toBe(false);
  });
});
