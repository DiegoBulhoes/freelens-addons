import { describe, expect, it } from "vitest";

import {
  APPLICATION_SET_CRD,
  CRD_NAMES,
  hasApplicationSets,
  hasImageUpdater,
  IMAGE_UPDATER_CRD,
  isInstalled,
} from "../../src/renderer/api/shared/installed";

describe("whether ArgoCD is installed", () => {
  it.each(CRD_NAMES)("counts it installed when %s is there, among others", (name) => {
    expect(isInstalled(["certificates.cert-manager.io", name, "widgets.example.test"])).toBe(true);
  });

  it("does not when the cluster has no CRDs at all", () => {
    expect(isInstalled([])).toBe(false);
  });

  it("does not for another operator's CRDs, or a name that only looks like one", () => {
    expect(isInstalled(["certificates.cert-manager.io", "widgets.example.test"])).toBe(false);
    expect(isInstalled(CRD_NAMES.map((name) => name.toUpperCase()))).toBe(false);
    expect(isInstalled(CRD_NAMES.map((name) => name.split(".")[0] ?? name))).toBe(false);
  });
});

describe("whether Argo CD Image Updater is installed", () => {
  it("counts it installed from its own CRD, and only from that", () => {
    expect(hasImageUpdater(["applications.argoproj.io", IMAGE_UPDATER_CRD])).toBe(true);
    expect(hasImageUpdater(["applications.argoproj.io", "imageupdaters.example.test"])).toBe(false);
    expect(hasImageUpdater([])).toBe(false);
  });
});

describe("whether ApplicationSets are installed", () => {
  it("shows their page from their own CRD, and only from that", () => {
    expect(hasApplicationSets(["applications.argoproj.io", APPLICATION_SET_CRD])).toBe(true);
    expect(APPLICATION_SET_CRD).toBe("applicationsets.argoproj.io");
    expect(hasApplicationSets(["applications.argoproj.io", "applicationsets.example.test"])).toBe(
      false,
    );
    expect(hasApplicationSets([])).toBe(false);
  });
});
