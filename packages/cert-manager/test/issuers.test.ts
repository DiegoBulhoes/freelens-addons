import { describe, expect, it } from "vitest";

import {
  dependsOnBrokenIssuer,
  getIssuerEntries,
  getIssuerRows,
  getMissingIssuers,
  isIssuerReady,
  issuerKey,
  issuerKindOf,
  issuerRouteOf,
  issuerSettings,
  issuerStatusOf,
  issuersHeadline,
  issuerTypeOf,
  resolveIssuer,
} from "../src/renderer/api/issuers";
import { certificateNamed, certificates, clusterIssuers, issuerIndex, variantOf } from "./fixtures";

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

describe("what the issuers page says", () => {
  const rows = getIssuerRows(index, certificates());
  const missing = getMissingIssuers(index, certificates());

  const rowOf = (name: string, from = rows) => {
    const row = from.find((each) => each.issuer.getName() === name);

    if (!row) throw new Error(`no issuer named ${name} in the fixtures`);

    return row;
  };

  it("shows each issuer's state as Ready, or the reason it is not", () => {
    expect(issuerStatusOf(rowOf("demo-ca"))).toEqual({ label: "Ready", tone: "ok" });
    expect(issuerStatusOf(rowOf("broken-ca"))).toEqual({
      label: "ErrGetKeyPair",
      tone: "critical",
    });
  });

  it("says Not ready for an issuer cert-manager has not judged yet", () => {
    const fresh = variantOf(rowOf("broken-ca").issuer, (raw) => {
      delete raw.status;
    });
    const unjudged = getIssuerRows({ issuers: [fresh], clusterIssuers: [] }, []);

    expect(issuerStatusOf(rowOf("broken-ca", unjudged))).toEqual({
      label: "Not ready",
      tone: "critical",
    });
  });

  it("counts the broken and the missing out of every issuer listed", () => {
    const failing = rows.filter((row) => !row.ready).length + missing.length;

    expect(failing).toBeGreaterThan(0);
    expect(issuersHeadline(rows, missing)).toBe(
      `${failing} of ${rows.length + missing.length} issuers are not ready or missing`,
    );
  });

  it("says so when every issuer is ready, and when there is none", () => {
    const ready = rows.filter((row) => row.ready);

    expect(issuersHeadline(ready, [])).toBe(`All ${ready.length} issuers are ready`);
    expect(issuersHeadline(ready.slice(0, 1), [])).toBe("All 1 issuer is ready");
    expect(issuersHeadline([], [])).toBe("No issuers");
  });

  it("reads one missing issuer out of one in the singular", () => {
    expect(issuersHeadline([], missing.slice(0, 1))).toBe("1 of 1 issuer is not ready or missing");
  });
});

describe("the issuers list", () => {
  const entries = getIssuerEntries(index, certificates());
  const entryOf = (name: string) => {
    const found = entries.find((each) => each.name === name);

    if (!found) throw new Error(`no issuer entry named ${name}`);

    return found;
  };

  it("lists the broken first, then the missing, then the ready", () => {
    const order = entries.map((each) =>
      each.issuer ? (each.state.tone === "ok" ? "ready" : "broken") : "missing",
    );
    const firstMissing = order.indexOf("missing");
    const firstReady = order.indexOf("ready");

    expect(order.slice(0, firstMissing).every((each) => each === "broken")).toBe(true);
    expect(order.slice(firstMissing, firstReady).every((each) => each === "missing")).toBe(true);
    expect(order.slice(firstReady).every((each) => each === "ready")).toBe(true);
    expect(firstMissing).toBeGreaterThan(0);
  });

  it("keys a namespaced Issuer by its namespace, a ClusterIssuer without one", () => {
    expect(entryOf("broken-ca")).toMatchObject({
      key: "Issuer/demo/broken-ca",
      kind: "Issuer",
      namespace: "demo",
      type: "CA",
    });
    expect(entryOf("demo-ca")).toMatchObject({
      key: "ClusterIssuer//demo-ca",
      namespace: undefined,
    });
    expect(issuerKey("ClusterIssuer", "", "demo-ca")).toBe(entryOf("demo-ca").key);
  });

  it("carries cert-manager's own message as the reason", () => {
    expect(entryOf("broken-ca").state).toMatchObject({ tone: "critical", label: "ErrGetKeyPair" });
    expect(entryOf("broken-ca").state.reason).toMatch(/no-such-secret/);
    expect(entryOf("demo-ca").state).toEqual({
      tone: "ok",
      label: "Ready",
      reason: "Signing CA verified",
    });
  });

  it("says a ready issuer without a message is ready to sign", () => {
    expect(entryOf("selfsigned").state.reason).toBe("Ready to sign.");
  });

  it("says a broken issuer without a message is reported not ready", () => {
    const silent = variantOf(
      index.issuers.find((each) => each.getName() === "broken-ca") as (typeof index.issuers)[0],
      (raw) => {
        delete raw.status.conditions[0].message;
      },
    );
    const [entry] = getIssuerEntries({ issuers: [silent], clusterIssuers: [] }, []);

    expect(entry?.state.reason).toMatch(/not ready, without a message/);
  });

  it("lists a named and missing issuer with the certificates that name it", () => {
    const missing = entryOf("does-not-exist");

    expect(missing.issuer).toBeUndefined();
    expect(missing.type).toBeUndefined();
    expect(missing.state).toMatchObject({ tone: "critical", label: "Missing" });
    expect(missing.state.reason).toMatch(/^Named by 1 certificate and not found\./);
    expect(missing.dependents.map((each) => each.getName())).toEqual(["orphan"]);
  });

  it("counts several certificates naming a missing issuer in the plural", () => {
    const twice = [
      ...certificates(),
      variantOf(certificateNamed("web-tls"), (raw) => {
        raw.spec.issuerRef = { kind: "ClusterIssuer", name: "does-not-exist" };
      }),
    ];
    const missing = getIssuerEntries(index, twice).find((each) => each.name === "does-not-exist");

    expect(missing?.state.reason).toMatch(/^Named by 2 certificates/);
  });

  it("puts each certificate under the issuer it names", () => {
    expect(entryOf("demo-ca").dependents.map((each) => each.getName())).toContain("web-tls");
  });
});

describe("what an issuer is configured with", () => {
  const named = (name: string) => {
    const found = [...index.issuers, ...index.clusterIssuers].find(
      (each) => each.getName() === name,
    );

    if (!found) throw new Error(`no issuer named ${name}`);

    return found;
  };

  it("shows an ACME issuer's server, account key Secret and registered account", () => {
    const terms = issuerSettings(named("pebble")).map((each) => each.term);

    expect(terms).toEqual(["ACME server", "Account key Secret", "Account"]);
    expect(issuerSettings(named("pebble"))[0]?.value).toMatch(/^https:\/\/pebble/);
  });

  it("shows the email when one is set", () => {
    const withEmail = variantOf(named("pebble"), (raw) => {
      raw.spec.acme.email = "ops@example.com";
    });

    expect(issuerSettings(withEmail)).toContainEqual({ term: "Email", value: "ops@example.com" });
  });

  it("shows a CA issuer's Secret by name", () => {
    expect(issuerSettings(named("demo-ca"))).toEqual([
      { term: "CA Secret", value: "demo-ca-root" },
    ]);
  });

  it("shows nothing for a self-signed issuer", () => {
    expect(issuerSettings(named("selfsigned"))).toEqual([]);
  });
});

describe("the issuer a certificate links to", () => {
  it("is a ClusterIssuer by name alone", () => {
    expect(issuerRouteOf(certificateNamed("web-tls"))).toEqual({
      kind: "ClusterIssuer",
      namespace: "",
      name: "demo-ca",
    });
  });

  it("is an Issuer in the certificate's namespace", () => {
    expect(issuerRouteOf(certificateNamed("never-issued"))).toEqual({
      kind: "Issuer",
      namespace: "demo",
      name: "broken-ca",
    });
  });

  it("is none for an external issuer, which the issuers page does not list", () => {
    const external = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.spec.issuerRef = { name: "pca", kind: "AWSPCAClusterIssuer", group: "awspca.example" };
    });

    expect(issuerRouteOf(external)).toBeUndefined();
  });
});
