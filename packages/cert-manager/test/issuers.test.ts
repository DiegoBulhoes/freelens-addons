import { describe, expect, it } from "vitest";

import {
  dependsOnBrokenIssuer,
  getIssuerRows,
  getMissingIssuers,
  isIssuerReady,
  issuerKindOf,
  issuerTypeOf,
  resolveIssuer,
} from "../src/renderer/api/issuers";
import { certificateNamed, certificates, clusterIssuers, issuerIndex, variantOf } from "./fixtures";

/**
 * One broken issuer is many broken certificates, and the line between them is
 * drawn here. An issuer resolved wrongly does not throw — it silently fails to
 * match, and a certificate waiting on a broken issuer reads as waiting on nothing.
 */

const index = issuerIndex();

describe("which kind of issuer a reference means", () => {
  it("means Issuer when kind is left out, as the API does", () => {
    expect(issuerKindOf({ name: "anything" })).toBe("Issuer");
  });

  it("reads ClusterIssuer when it says so", () => {
    expect(issuerKindOf({ name: "demo-ca", kind: "ClusterIssuer" })).toBe("ClusterIssuer");
    expect(issuerKindOf({ name: "demo-ca", kind: "ClusterIssuer", group: "cert-manager.io" })).toBe(
      "ClusterIssuer",
    );
  });

  it("recognises an external issuer by its group, whatever its kind", () => {
    expect(
      issuerKindOf({ name: "pca", kind: "AWSPCAClusterIssuer", group: "awspca.cert-manager.io" }),
    ).toBe("External");
  });
});

describe("resolving the issuer a certificate names", () => {
  it("finds a ClusterIssuer by name alone", () => {
    expect(resolveIssuer(certificateNamed("web-tls"), index)?.getName()).toBe("demo-ca");
  });

  it("finds an Issuer only in the certificate's own namespace", () => {
    const issuer = resolveIssuer(certificateNamed("never-issued"), index);

    expect(issuer?.getName()).toBe("broken-ca");
    expect(issuer?.getNs()).toBe("demo");
  });

  it("finds nothing when the issuer does not exist", () => {
    expect(resolveIssuer(certificateNamed("orphan"), index)).toBeUndefined();
  });

  it("does not look for an external issuer among cert-manager's own", () => {
    const external = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.spec.issuerRef = { name: "demo-ca", kind: "ClusterIssuer", group: "example.com" };
    });

    expect(resolveIssuer(external, index)).toBeUndefined();
  });
});

describe("whether an issuer works", () => {
  it("reads its Ready condition", () => {
    const ready = clusterIssuers().find((each) => each.getName() === "demo-ca");
    const broken = index.issuers.find((each) => each.getName() === "broken-ca");

    expect(ready && isIssuerReady(ready)).toBe(true);
    expect(broken && isIssuerReady(broken)).toBe(false);
  });

  it("names what kind of issuer it is", () => {
    const byName = (name: string) => clusterIssuers().find((each) => each.getName() === name);
    const pebble = byName("pebble");
    const demo = byName("demo-ca");
    const selfSigned = byName("selfsigned");

    expect(pebble && issuerTypeOf(pebble)).toBe("ACME");
    expect(demo && issuerTypeOf(demo)).toBe("CA");
    expect(selfSigned && issuerTypeOf(selfSigned)).toBe("Self-signed");
  });

  it("names the kinds the cluster does not run, and says Other for the rest", () => {
    const base = clusterIssuers().find((each) => each.getName() === "selfsigned");

    if (!base) throw new Error("no selfsigned issuer in the fixtures");

    const as = (spec: Record<string, unknown>) =>
      variantOf(base, (raw) => {
        raw.spec = spec;
      });

    expect(issuerTypeOf(as({ vault: { server: "https://vault" } }))).toBe("Vault");
    expect(issuerTypeOf(as({ venafi: { zone: "z" } }))).toBe("Venafi");
    expect(issuerTypeOf(as({}))).toBe("Other");
  });

  it("connects a certificate to the broken issuer it is waiting on", () => {
    expect(dependsOnBrokenIssuer(certificateNamed("never-issued"), index)).toBe(true);
    // Issued while flaky-ca worked; its renewal waits on it now.
    expect(dependsOnBrokenIssuer(certificateNamed("renewal-stalls"), index)).toBe(true);
    expect(dependsOnBrokenIssuer(certificateNamed("web-tls"), index)).toBe(false);
    // Missing is not broken: there is nothing there to be broken.
    expect(dependsOnBrokenIssuer(certificateNamed("orphan"), index)).toBe(false);
  });
});

describe("the issuers list", () => {
  const rows = getIssuerRows(index, certificates());

  it("lists every Issuer and ClusterIssuer once", () => {
    expect(rows).toHaveLength(index.issuers.length + index.clusterIssuers.length);
  });

  it("puts the broken ones first", () => {
    const firstReady = rows.findIndex((row) => row.ready);

    expect(firstReady).toBeGreaterThan(0);
    expect(rows.slice(firstReady).every((row) => row.ready)).toBe(true);
  });

  it("orders the working ones by how much depends on them", () => {
    const ready = rows.filter((row) => row.ready);

    for (let at = 1; at < ready.length; at++) {
      expect(ready[at - 1]?.dependents.length).toBeGreaterThanOrEqual(
        ready[at]?.dependents.length ?? 0,
      );
    }
  });

  it("counts the certificates that depend on each", () => {
    const demo = rows.find((row) => row.issuer.getName() === "demo-ca");
    const flaky = rows.find((row) => row.issuer.getName() === "flaky-ca");

    expect(demo?.dependents.map((each) => each.getName()).sort()).toEqual([
      "ends-this-month",
      "ends-this-week",
      "managed-tls",
      "web-tls",
    ]);
    expect(flaky?.dependents.map((each) => each.getName())).toEqual(["renewal-stalls"]);
    expect(flaky?.reason).toBe("ErrGetKeyPair");
  });
});

describe("issuers that are named and do not exist", () => {
  it("collects them with the certificates naming them", () => {
    const missing = getMissingIssuers(index, certificates());

    expect(missing).toEqual([
      expect.objectContaining({
        kind: "ClusterIssuer",
        name: "does-not-exist",
        namespace: undefined,
      }),
    ]);
    expect(missing[0]?.dependents.map((each) => each.getName())).toEqual(["orphan"]);
  });

  it("looks for a missing Issuer in the certificate's namespace, and groups by it", () => {
    const naming = (name: string) =>
      variantOf(certificateNamed(name), (raw) => {
        raw.spec.issuerRef = { name: "nowhere" };
      });

    const missing = getMissingIssuers(index, [naming("web-tls"), naming("ends-this-week")]);

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ kind: "Issuer", name: "nowhere", namespace: "demo" });
    expect(missing[0]?.dependents).toHaveLength(2);
  });

  it("does not call an external issuer missing", () => {
    const external = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.spec.issuerRef = {
        name: "pca",
        kind: "AWSPCAClusterIssuer",
        group: "awspca.cert-manager.io",
      };
    });

    expect(getMissingIssuers(index, [external])).toEqual([]);
  });

  it("sorts what it finds by name", () => {
    const naming = (name: string, issuer: string) =>
      variantOf(certificateNamed(name), (raw) => {
        raw.spec.issuerRef = { name: issuer, kind: "ClusterIssuer" };
      });

    const missing = getMissingIssuers(index, [
      naming("web-tls", "zulu"),
      naming("orphan", "alpha"),
    ]);

    expect(missing.map((each) => each.name)).toEqual(["alpha", "zulu"]);
  });
});
