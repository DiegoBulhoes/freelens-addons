import { describe, expect, it } from "vitest";

import {
  clusterListings,
  isListedIn,
  listedSecrets,
  mergeListings,
  namespaceTlsSecretsPath,
  type PartialObjectMetadataList,
  secretsRefusal,
  settledListings,
  settleInSlots,
  tlsSecretsFrom,
} from "../../src/renderer/api/unmanaged/secret-metadata";
import {
  getServedTls,
  isGap,
  uncheckedSecretNote,
} from "../../src/renderer/api/unmanaged/unmanaged";
import tlsSecretsJson from "../fixtures/tls-secrets.json";
import { certificates, ingresses } from "../support/fixtures";

type RawSecret = { metadata: { namespace?: string } };

const raw = (tlsSecretsJson as { items: RawSecret[] }).items;

// What a namespace's own list returns: the exported cluster-wide list, cut to that namespace.
const listIn = (namespace: string): PartialObjectMetadataList => ({
  items: raw
    .filter((item) => item.metadata.namespace === namespace)
    .map((item) => ({ metadata: item.metadata })),
});

const namespaces = [...new Set(raw.map((item) => item.metadata.namespace ?? ""))].sort();
const everySecret = tlsSecretsFrom({ items: raw.map((item) => ({ metadata: item.metadata })) });
const refused = (reason: string): PromiseRejectedResult => ({
  status: "rejected",
  reason: new Error(reason),
});
const listed = (namespace: string): PromiseFulfilledResult<ReturnType<typeof tlsSecretsFrom>> => ({
  status: "fulfilled",
  value: tlsSecretsFrom(listIn(namespace)),
});

describe("asking a namespace for its TLS Secrets", () => {
  it("asks that namespace only, for TLS Secrets only", () => {
    expect(decodeURIComponent(namespaceTlsSecretsPath("demo"))).toBe(
      "/api/v1/namespaces/demo/secrets?fieldSelector=type=kubernetes.io/tls",
    );
  });
});

describe("a cluster-wide list", () => {
  it("answers for every namespace asked about, those without a TLS Secret too", () => {
    const listings = clusterListings(everySecret, ["demo", "no-tls-here"]);

    expect(isListedIn(listings, "no-tls-here")).toBe(true);
    expect(listings.get("no-tls-here")).toEqual([]);
    expect(listedSecrets(listings)).toHaveLength(everySecret.length);
    expect(secretsRefusal(listings, ["demo", "no-tls-here"])).toBeUndefined();
  });
});

describe("listing namespace by namespace", () => {
  it("keeps what the namespaces that answered said when one is refused", () => {
    const listings = settledListings(
      namespaces,
      namespaces.map((namespace) =>
        namespace === "kube-system" ? refused("403 Forbidden") : listed(namespace),
      ),
    );

    expect(isListedIn(listings, "demo")).toBe(true);
    expect(isListedIn(listings, "kube-system")).toBe(false);
    expect(listedSecrets(listings).map((each) => `${each.getNs()}/${each.getName()}`)).toContain(
      "demo/hand-made-tls",
    );
    expect(listedSecrets(listings).some((each) => each.getNs() === "kube-system")).toBe(false);
    expect(secretsRefusal(listings, namespaces)).toEqual({
      namespaces: ["kube-system"],
      error: "403 Forbidden",
      everywhere: false,
    });
  });

  it("says when every namespace was refused", () => {
    const listings = settledListings(["demo"], [refused("403 Forbidden")]);

    expect(secretsRefusal(listings, ["demo"])?.everywhere).toBe(true);
  });

  it("counts a namespace with no answer as not listed, and one not asked about as not known", () => {
    const listings = settledListings(["demo"], []);

    expect(listings.get("demo")).toEqual({ error: "not listed" });
    expect(isListedIn(listings, "redis")).toBe(false);
  });

  it("judges the served Secrets only where they were listed", () => {
    const demoRefused = settledListings(
      namespaces,
      namespaces.map((namespace) => (namespace === "demo" ? refused("403") : listed(namespace))),
    );
    const otherRefused = settledListings(
      namespaces,
      namespaces.map((namespace) => (namespace === "demo" ? listed(namespace) : refused("403"))),
    );
    const served = (listings: typeof demoRefused) =>
      getServedTls(ingresses(), listedSecrets(listings), certificates(), (namespace) =>
        isListedIn(listings, namespace),
      );
    const stateOf = (listings: typeof demoRefused, ingress: string) =>
      served(listings).find((each) => each.ingress === ingress)?.state;

    expect(stateOf(demoRefused, "missing-secret")).toBe("unchecked");
    expect(stateOf(otherRefused, "missing-secret")).toBe("missing");
    expect(stateOf(otherRefused, "unmanaged")).toBe("unmanaged");
    expect(served(demoRefused).filter(isGap)).toHaveLength(
      served(otherRefused).filter(isGap).length,
    );
  });
});

describe("listing again", () => {
  it("keeps a namespace's Secrets when its next list fails", () => {
    const before = settledListings(["demo"], [listed("demo")]);
    const merged = mergeListings(before, settledListings(["demo"], [refused("timeout")]));

    expect(isListedIn(merged, "demo")).toBe(true);
    expect(listedSecrets(merged)).toHaveLength(listedSecrets(before).length);
  });

  it("takes the new answer when it is one, and a refusal where nothing was listed", () => {
    const before = settledListings(["demo", "redis"], [refused("403"), listed("redis")]);
    const merged = mergeListings(
      before,
      settledListings(
        ["demo", "redis", "mongodb"],
        [listed("demo"), listed("redis"), refused("403")],
      ),
    );

    expect(isListedIn(merged, "demo")).toBe(true);
    expect(isListedIn(merged, "mongodb")).toBe(false);
    expect(merged.get("redis")).not.toBe(before.get("redis"));
  });
});

describe("reading many namespaces", () => {
  it("keeps at most the slots given in flight, and each outcome in its namespace's place", async () => {
    let inFlight = 0;
    let most = 0;
    const read = async (namespace: string) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (namespace === "kube-system") throw new Error("403 Forbidden");

      return tlsSecretsFrom(listIn(namespace));
    };

    const results = await settleInSlots(namespaces, 3, read);
    const listings = settledListings(namespaces, results);

    expect(namespaces.length).toBeGreaterThan(3);
    expect(most).toBe(3);
    expect(results).toHaveLength(namespaces.length);
    expect(isListedIn(listings, "demo")).toBe(true);
    expect(listings.get("kube-system")).toEqual({ error: "403 Forbidden" });
  });

  it("reads nothing for no namespace", async () => {
    expect(await settleInSlots([], 4, async () => [])).toEqual([]);
  });
});

describe("an unchecked Secret's note in the served drawer", () => {
  const unchecked = (
    refusal: ReturnType<typeof secretsRefusal>,
    listings: ReturnType<typeof settledListings>,
  ) => {
    const entry = getServedTls(ingresses(), listedSecrets(listings), certificates(), (namespace) =>
      isListedIn(listings, namespace),
    ).find((each) => each.ingress === "missing-secret");

    if (entry?.state !== "unchecked") throw new Error("missing-secret is not unchecked");

    return uncheckedSecretNote(entry, refusal);
  };

  it("says the Secrets could not be listed where the namespace refused", () => {
    const listings = settledListings(
      namespaces,
      namespaces.map((namespace) => (namespace === "demo" ? refused("403") : listed(namespace))),
    );

    expect(unchecked(secretsRefusal(listings, namespaces), listings)).toBe("(could not be listed)");
  });

  it("says not listed yet before the namespace has answered", () => {
    const listings = settledListings([], []);

    expect(unchecked(secretsRefusal(listings, namespaces), listings)).toBe("(not listed yet)");
  });
});
