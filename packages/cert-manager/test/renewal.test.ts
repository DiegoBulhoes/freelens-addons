import { describe, expect, it } from "vitest";

import { type ChainInputs, chainOf, explanationOf } from "../src/renderer/api/chain";
import {
  describeRefusal,
  MANUAL_TRIGGER,
  renewalPatch,
  renewalVerdict,
  statusPath,
} from "../src/renderer/api/renewal";
import {
  certificateNamed,
  certificateRequests,
  challenges,
  fixtureNow,
  issuerIndex,
  orders,
} from "./fixtures";

const inputs: ChainInputs = {
  index: issuerIndex(),
  requests: certificateRequests(),
  orders: orders(),
  challenges: challenges(),
};

const verdictOf = (name: string) => {
  const certificate = certificateNamed(name);

  return renewalVerdict(certificate, explanationOf(chainOf(certificate, inputs)));
};

describe("whether to offer a renewal", () => {
  it("offers it for a healthy certificate, without a warning", () => {
    expect(verdictOf("web-tls")).toEqual({ offer: true });
  });

  it("does not offer it while cert-manager is already issuing, and names what holds it up", () => {
    const acme = verdictOf("acme-web");

    expect(acme.offer).toBe(false);
    expect(!acme.offer && acme.reason).toMatch(/already issuing.*Challenge acme-web-1-/);
  });

  it("names the broken issuer behind a renewal that is already running and failing", () => {
    const stalls = verdictOf("renewal-stalls");

    expect(stalls.offer).toBe(false);
    expect(!stalls.offer && stalls.reason).toMatch(/Issuer flaky-ca/);
  });

  it("says only that it is already issuing when nothing explains it", () => {
    const verdict = renewalVerdict(certificateNamed("acme-web"), undefined);

    expect(verdict).toEqual({
      offer: false,
      reason: "cert-manager is already issuing it, so renewing again does nothing.",
    });
  });

  it("offers it with a warning when the issuer is broken and nothing is issuing yet", () => {
    const verdict = renewalVerdict(certificateNamed("web-tls"), {
      kind: "ClusterIssuer",
      name: "demo-ca",
      state: "failed",
    });

    expect(verdict.offer).toBe(true);
    expect(verdict.offer && verdict.warning).toMatch(/ClusterIssuer demo-ca.*will fail/);
  });

  it("does not warn about a link that is not the issuer", () => {
    const verdict = renewalVerdict(certificateNamed("web-tls"), {
      kind: "Challenge",
      name: "x",
      state: "pending",
    });

    expect(verdict).toEqual({ offer: true });
  });
});

describe("the patch", () => {
  const now = fixtureNow();

  it("sets Issuing to true, the way cmctl renew does", () => {
    const patch = renewalPatch(certificateNamed("web-tls"), now);
    const issuing = patch.status.conditions.find((each) => each.type === "Issuing");

    expect(issuing).toMatchObject({ status: "True", ...MANUAL_TRIGGER });
    expect(issuing?.lastTransitionTime).toBe(new Date(now).toISOString().replace(/\.\d+Z$/, "Z"));
  });

  it("keeps every other condition, because a merge patch replaces the list whole", () => {
    const certificate = certificateNamed("web-tls");
    const patch = renewalPatch(certificate, now);

    expect(patch.status.conditions.map((each) => each.type)).toEqual(["Ready", "Issuing"]);
    expect(patch.status.conditions[0]).toEqual(certificate.status?.conditions?.[0]);
  });

  it("replaces an Issuing condition rather than adding a second", () => {
    const patch = renewalPatch(certificateNamed("renewal-stalls"), now);

    expect(patch.status.conditions.filter((each) => each.type === "Issuing")).toHaveLength(1);
  });

  it("carries the resourceVersion it was computed from, as a precondition", () => {
    const certificate = certificateNamed("web-tls");

    expect(renewalPatch(certificate, now).metadata.resourceVersion).toBe(
      certificate.metadata.resourceVersion,
    );
    expect(certificate.metadata.resourceVersion).toBeTruthy();
  });

  it("records the generation it observed, and leaves it out when there is none", () => {
    const certificate = certificateNamed("web-tls");
    const withGeneration = renewalPatch(certificate, now).status.conditions.at(-1) as {
      observedGeneration?: number;
    };

    expect(withGeneration.observedGeneration).toBe(certificate.metadata.generation);

    const bare = { ...certificate, metadata: { ...certificate.metadata, generation: undefined } };
    const withoutGeneration = renewalPatch(bare as typeof certificate, now).status.conditions.at(
      -1,
    );

    expect(withoutGeneration).not.toHaveProperty("observedGeneration");
  });

  it("starts from nothing for a certificate with no status yet", () => {
    const fresh = { ...certificateNamed("web-tls"), status: undefined };

    expect(renewalPatch(fresh as never, now).status.conditions.map((each) => each.type)).toEqual([
      "Issuing",
    ]);
  });

  it("goes to the status subresource, the only place a condition is kept", () => {
    expect(statusPath(certificateNamed("web-tls"))).toBe(
      "/apis/cert-manager.io/v1/namespaces/demo/certificates/web-tls/status",
    );
  });
});

describe("when the API server refuses", () => {
  it("names the permission that is missing", () => {
    expect(describeRefusal(403, "forbidden")).toMatch(/patch certificates\/status/);
  });

  it("says nothing was written when the certificate changed underneath", () => {
    expect(describeRefusal(409, "the object has been modified")).toMatch(/Nothing was written/);
  });

  it("passes anything else through, with or without a message", () => {
    expect(describeRefusal(500, "boom")).toBe("The API server refused (500): boom");
    expect(describeRefusal(502, undefined)).toBe("The API server refused (502).");
  });
});
