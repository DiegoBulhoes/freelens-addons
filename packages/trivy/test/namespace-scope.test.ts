import { describe, expect, it } from "vitest";
import { scopeKey, withinScope } from "../src/renderer/api/namespace-scope";
import { getOverview } from "../src/renderer/api/overview";
import {
  clusterRbacReports,
  configAuditReports,
  exposedSecretReports,
  rbacReports,
  sbomReports,
  vulnerabilityReports,
} from "./fixtures";

describe("what the namespace selector leaves on a page", () => {
  it("keeps what lives in a chosen namespace, and nothing from the others", () => {
    const all = vulnerabilityReports();
    const kept = withinScope(all, ["demo"]);

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(all.length);
    for (const report of kept) expect(report.getNs()).toBe("demo");
  });

  it("keeps nothing namespaced for a namespace that holds none of it", () => {
    expect(withinScope(vulnerabilityReports(), ["default"])).toEqual([]);
    expect(withinScope(rbacReports(), [])).toEqual([]);
  });

  it("keeps every ClusterRole whatever is chosen, since one reaches every namespace", () => {
    const clusterWide = clusterRbacReports();

    expect(clusterWide.length).toBeGreaterThan(0);
    expect(withinScope(clusterWide, ["default"])).toHaveLength(clusterWide.length);
    expect(withinScope([...rbacReports(), ...clusterWide], [])).toHaveLength(clusterWide.length);
  });

  it("empties the overview for a namespace with no report, rather than calling it clean", () => {
    const scope = ["default"];
    const overview = getOverview({
      vulnerabilityReports: withinScope(vulnerabilityReports(), scope),
      sbomReports: withinScope(sbomReports(), scope),
      configAuditReports: withinScope(configAuditReports(), scope),
      exposedSecretReports: withinScope(exposedSecretReports(), scope),
    });

    expect(overview.counts.total).toBe(0);
  });

  it("names a scope the same way whatever order it was picked in", () => {
    expect(scopeKey(["demo", "argocd"])).toBe(scopeKey(["argocd", "demo"]));
    expect(scopeKey(["argocd"])).not.toBe(scopeKey(["argocd", "demo"]));
  });
});
