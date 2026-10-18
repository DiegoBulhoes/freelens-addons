import { describe, expect, it } from "vitest";

import { CRD_NAMES, isInstalled } from "../../src/renderer/api/shared/installed";

describe("installed", () => {
  it("with any of the kinds the pages read", () => {
    expect(isInstalled([CRD_NAMES[0] ?? ""])).toBe(true);
    expect(isInstalled(["prometheusrules.monitoring.coreos.com"])).toBe(true);
    expect(
      isInstalled([
        "thanosrulers.monitoring.coreos.com",
        "opentelemetrycollectors.opentelemetry.io",
      ]),
    ).toBe(false);
  });
});
