import { describe, expect, it } from "vitest";

import {
  CRD_NAMES,
  hasObjectStores,
  isInstalled,
  OBJECT_STORE_CRD,
} from "../src/renderer/api/installed";

describe("whether CloudNativePG is installed", () => {
  it.each(CRD_NAMES)("counts it installed when %s is there, among others", (name) => {
    expect(isInstalled(["applications.argoproj.io", name])).toBe(true);
  });

  it("does not without its CRDs, or for a name that only looks like one", () => {
    expect(isInstalled([])).toBe(false);
    expect(isInstalled(["clusters.example.test", "backups.postgresql.cnpg.io"])).toBe(false);
    expect(isInstalled(CRD_NAMES.map((name) => name.toUpperCase()))).toBe(false);
  });

  it("knows the Barman Cloud plugin by its ObjectStore CRD only", () => {
    expect(hasObjectStores([...CRD_NAMES, OBJECT_STORE_CRD])).toBe(true);
    expect(hasObjectStores(CRD_NAMES)).toBe(false);
  });
});
