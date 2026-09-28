import { describe, expect, it } from "vitest";

import {
  type ChainInputs,
  chainOf,
  challengesOf,
  explanationOf,
  latestRequestOf,
  ordersOf,
} from "../src/renderer/api/chain";
import {
  certificateNamed,
  certificateRequests,
  challenges,
  issuerIndex,
  orders,
  variantOf,
} from "./fixtures";

/**
 * The reason a certificate is stuck is usually three kinds away from it. These
 * walk the real objects the cluster made for each stuck certificate and check
 * that the link picked out is the one that explains the rest.
 */

const inputs: ChainInputs = {
  index: issuerIndex(),
  requests: certificateRequests(),
  orders: orders(),
  challenges: challenges(),
};

const kinds = (chain: ReturnType<typeof chainOf>) =>
  chain.map((link) => `${link.kind}:${link.state}`);

describe("finding the current request", () => {
  it("takes the highest revision, because the older ones are usually gone", () => {
    // renewal-stalls-1 was collected; revision 2 is the renewal that is waiting.
    expect(latestRequestOf(certificateNamed("renewal-stalls"), inputs.requests)?.getName()).toBe(
      "renewal-stalls-2",
    );
  });

  it("prefers the higher revision when both are still there", () => {
    const request = latestRequestOf(certificateNamed("web-tls"), inputs.requests);

    if (!request) throw new Error("web-tls has no request in the fixtures");

    const newer = variantOf(request, (raw) => {
      raw.metadata.name = "web-tls-2";
      raw.metadata.annotations["cert-manager.io/certificate-revision"] = "2";
    });

    expect(latestRequestOf(certificateNamed("web-tls"), [request, newer])?.getName()).toBe(
      "web-tls-2",
    );
  });

  it("breaks a tie on revision by age", () => {
    const request = latestRequestOf(certificateNamed("web-tls"), inputs.requests);

    if (!request) throw new Error("web-tls has no request in the fixtures");

    const later = variantOf(request, (raw) => {
      raw.metadata.name = "web-tls-later";
      raw.metadata.creationTimestamp = "2099-01-01T00:00:00Z";
    });

    expect(latestRequestOf(certificateNamed("web-tls"), [request, later])?.getName()).toBe(
      "web-tls-later",
    );
  });

  it("reads a request without a revision as the oldest", () => {
    const request = latestRequestOf(certificateNamed("web-tls"), inputs.requests);

    if (!request) throw new Error("web-tls has no request in the fixtures");

    const unrevised = variantOf(request, (raw) => {
      raw.metadata.name = "web-tls-unrevised";
      delete raw.metadata.annotations["cert-manager.io/certificate-revision"];
      raw.metadata.creationTimestamp = "2099-01-01T00:00:00Z";
    });

    expect(latestRequestOf(certificateNamed("web-tls"), [unrevised, request])?.getName()).toBe(
      "web-tls-1",
    );
  });

  it("does not take another certificate's request", () => {
    expect(latestRequestOf(certificateNamed("web-tls"), inputs.requests)?.getName()).toBe(
      "web-tls-1",
    );
  });

  it("does not claim a request someone made by hand, which no Certificate owns", () => {
    const request = latestRequestOf(certificateNamed("web-tls"), inputs.requests);

    if (!request) throw new Error("web-tls has no request in the fixtures");

    const handMade = variantOf(request, (raw) => {
      delete raw.metadata.ownerReferences;
    });

    expect(latestRequestOf(certificateNamed("web-tls"), [handMade])).toBeUndefined();
  });

  it("matches by owner name when the owner carries no uid", () => {
    const certificate = variantOf(certificateNamed("web-tls"), (raw) => {
      delete raw.metadata.uid;
    });

    expect(latestRequestOf(certificate, inputs.requests)?.getName()).toBe("web-tls-1");
  });
});

describe("the ACME links under a request", () => {
  const request = latestRequestOf(certificateNamed("acme-web"), inputs.requests);

  it("finds the order a request opened, and the challenge the order opened", () => {
    if (!request) throw new Error("acme-web has no request in the fixtures");

    const [order] = ordersOf(request, inputs.orders);

    expect(order).toBeDefined();
    expect(order && challengesOf(order, inputs.challenges)).toHaveLength(1);
  });

  it("finds no order for a request to a CA issuer", () => {
    const ca = latestRequestOf(certificateNamed("web-tls"), inputs.requests);

    expect(ca && ordersOf(ca, inputs.orders)).toEqual([]);
  });
});

describe("the chain for each stuck certificate", () => {
  it("runs to the challenge for ACME, and the challenge explains it", () => {
    const chain = chainOf(certificateNamed("acme-web"), inputs);

    expect(kinds(chain)).toEqual([
      "ClusterIssuer:ok",
      "Certificate:pending",
      "CertificateRequest:pending",
      "Order:pending",
      "Challenge:pending",
    ]);

    const explanation = explanationOf(chain);

    // The order is pending too, and says nothing; the challenge says why.
    expect(explanation?.kind).toBe("Challenge");
    expect(explanation?.reason).toMatch(/self check/);
  });

  it("blames the issuer when a renewal waits on one that broke", () => {
    const chain = chainOf(certificateNamed("renewal-stalls"), inputs);

    expect(kinds(chain)).toEqual(["Issuer:failed", "Certificate:ok", "CertificateRequest:pending"]);
    expect(explanationOf(chain)).toMatchObject({
      kind: "Issuer",
      name: "flaky-ca",
      namespace: "demo",
    });
  });

  it("names an issuer that is not there, with where it was looked for", () => {
    const chain = chainOf(certificateNamed("orphan"), inputs);

    expect(chain[0]).toMatchObject({
      kind: "ClusterIssuer",
      state: "missing",
      name: "does-not-exist",
    });
    expect(chain[0]?.reason).toBe("No ClusterIssuer named does-not-exist");
    expect(explanationOf(chain)?.state).toBe("missing");
  });

  it("says where a missing Issuer was looked for", () => {
    const chain = chainOf(
      variantOf(certificateNamed("orphan"), (raw) => {
        raw.spec.issuerRef = { name: "nowhere" };
      }),
      inputs,
    );

    expect(chain[0]?.reason).toBe("No Issuer named nowhere in demo");
  });

  it("has nothing to explain for a healthy certificate", () => {
    const chain = chainOf(certificateNamed("web-tls"), inputs);

    expect(chain.every((link) => link.state === "ok")).toBe(true);
    expect(explanationOf(chain)).toBeUndefined();
  });

  it("stops at the certificate when it has made no request yet", () => {
    const chain = chainOf(certificateNamed("web-tls"), { ...inputs, requests: [] });

    expect(kinds(chain)).toEqual(["ClusterIssuer:ok", "Certificate:ok"]);
  });

  it("leaves the issuer out when it is external, rather than calling it missing", () => {
    const external = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.spec.issuerRef = {
        name: "pca",
        kind: "AWSPCAClusterIssuer",
        group: "awspca.cert-manager.io",
      };
    });

    expect(chainOf(external, inputs)[0]?.kind).toBe("Certificate");
  });
});

describe("states the cluster did not reach", () => {
  const acme = certificateNamed("acme-web");

  it("reads a denied request as failed, with the denial as the reason", () => {
    const denied = inputs.requests.map((request) =>
      request.getName() === "acme-web-1"
        ? variantOf(request, (raw) => {
            raw.status.conditions.push({
              type: "Denied",
              status: "True",
              reason: "Policy",
              message: "Denied by an approver policy",
            });
          })
        : request,
    );

    const chain = chainOf(acme, { ...inputs, requests: denied, orders: [] });

    expect(chain.at(-1)).toMatchObject({
      kind: "CertificateRequest",
      state: "failed",
      reason: "Denied by an approver policy",
    });
  });

  it("reads a request whose Ready reason is Failed as failed", () => {
    const failed = inputs.requests.map((request) =>
      request.getName() === "acme-web-1"
        ? variantOf(request, (raw) => {
            const ready = raw.status.conditions.find(
              (each: { type: string }) => each.type === "Ready",
            );
            ready.reason = "Failed";
            ready.message = "The CSR PEM requests a commonName that is not present";
          })
        : request,
    );

    expect(chainOf(acme, { ...inputs, requests: failed, orders: [] }).at(-1)?.state).toBe("failed");
  });

  it("reads an order and a challenge that went through as fine, and one that errored as failed", () => {
    const valid = inputs.orders.map((order) =>
      variantOf(order, (raw) => {
        raw.status.state = "valid";
      }),
    );
    const errored = inputs.challenges.map((challenge) =>
      variantOf(challenge, (raw) => {
        raw.status.state = "invalid";
        raw.status.reason =
          "Error accepting authorization: acme: urn:ietf:params:acme:error:connection";
      }),
    );

    const chain = chainOf(acme, { ...inputs, orders: valid, challenges: errored });

    expect(kinds(chain).slice(-2)).toEqual(["Order:ok", "Challenge:failed"]);
    expect(explanationOf(chain)?.kind).toBe("Challenge");
  });

  it("reads a certificate that is neither ready nor issuing as failed", () => {
    const stopped = variantOf(certificateNamed("orphan"), (raw) => {
      raw.status.conditions = raw.status.conditions.filter(
        (each: { type: string }) => each.type !== "Issuing",
      );
    });

    const certificateLink = chainOf(stopped, inputs).find((link) => link.kind === "Certificate");

    expect(certificateLink?.state).toBe("failed");
  });

  it("falls back to the deepest troubled link when none of them says why", () => {
    const silent = [
      { kind: "Certificate" as const, name: "a", state: "pending" as const },
      { kind: "CertificateRequest" as const, name: "b", state: "pending" as const },
    ];

    expect(explanationOf(silent)?.name).toBe("b");
  });
});
