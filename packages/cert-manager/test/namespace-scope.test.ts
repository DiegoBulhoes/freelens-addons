import { describe, expect, it } from "vitest";

import { scopeKey, withinScope } from "../src/renderer/api/namespace-scope";
import { certificates, clusterIssuers, issuers, tlsSecrets } from "./fixtures";

describe("what the namespace selector leaves on a page", () => {
  it("keeps what lives in a chosen namespace, and nothing from the others", () => {
    const all = certificates();
    const demo = withinScope(all, ["demo"]);

    expect(demo.length).toBeGreaterThan(0);
    expect(demo.length).toBeLessThan(all.length);
    expect(demo.every((certificate) => certificate.getNs() === "demo")).toBe(true);
  });

  it("keeps the union of every namespace chosen", () => {
    const secrets = tlsSecrets();

    expect(withinScope(secrets, ["demo", "kube-system", "cert-manager"])).toHaveLength(
      secrets.length,
    );
    expect(withinScope(secrets, ["kube-system"]).map((secret) => secret.getName())).toEqual([
      "k3s-serving",
    ]);
  });

  it("keeps nothing namespaced for a namespace that holds nothing of it", () => {
    expect(withinScope(certificates(), ["default"])).toEqual([]);
    expect(withinScope(issuers(), [])).toEqual([]);
  });

  it("keeps every ClusterIssuer whatever is chosen, since none lives in a namespace", () => {
    expect(withinScope(clusterIssuers(), ["default"])).toHaveLength(clusterIssuers().length);
    expect(withinScope(clusterIssuers(), [])).toHaveLength(clusterIssuers().length);
  });

  it("names a scope the same way whatever order it was picked in", () => {
    expect(scopeKey(["demo", "cert-manager"])).toBe(scopeKey(["cert-manager", "demo"]));
    expect(scopeKey(["demo"])).not.toBe(scopeKey(["demo", "cert-manager"]));
  });
});
