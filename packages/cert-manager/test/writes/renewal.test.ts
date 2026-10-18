import { describe, expect, it } from "vitest";

import { chainOf, explanationOf } from "../../src/renderer/api/certificates/chain";
import {
  backoffAfter,
  describeFailures,
  describeRefusal,
  issuanceFailuresOf,
  MANUAL_TRIGGER,
  renewalPatch,
  renewalPhrase,
  renewalVerdict,
  renewNowNote,
  statusPath,
} from "../../src/renderer/api/writes/renewal";
import { certificateNamed, chainInputs, fixtureNow, variantOf } from "../support/fixtures";

const inputs = chainInputs();

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
    // web-tls on flaky-ca, as if issued before flaky-ca lost its key: Ready, nothing issuing.
    const onFlaky = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.spec.issuerRef = { name: "flaky-ca", kind: "Issuer", group: "cert-manager.io" };
    });
    const verdict = renewalVerdict(onFlaky, explanationOf(chainOf(onFlaky, inputs)));

    expect(verdict).toEqual({
      offer: true,
      warning:
        "Its issuer is not usable (Issuer flaky-ca), so the renewal will fail until that is fixed.",
    });
  });

  it("warns for issuer-broken, still valid on an issuer that has lost its key", () => {
    expect(verdictOf("issuer-broken")).toEqual({
      offer: true,
      warning:
        "Its issuer is not usable (Issuer flaky-ca), so the renewal will fail until that is fixed.",
    });
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

describe("when the drawer says a certificate renews", () => {
  it("reads renewBefore as a time before the end", () => {
    expect(renewalPhrase(certificateNamed("web-tls").spec)).toBe("360h before the end");
  });

  it("reads renewBeforePercentage as the share of the lifetime left", () => {
    const relative = variantOf(certificateNamed("web-tls"), (raw) => {
      delete raw.spec.renewBefore;
      raw.spec.renewBeforePercentage = 25;
    });

    expect(renewalPhrase(relative.spec)).toBe("when 25% of its lifetime is left");
  });

  it("falls back to cert-manager's two thirds when neither is set", () => {
    expect(renewalPhrase(certificateNamed("inventory-db-server-tls").spec)).toBe("at two thirds");
  });
});

describe("failed issuance attempts", () => {
  const HOUR = 60 * 60 * 1000;
  const now = fixtureNow();
  // never-issued as cert-manager leaves it after its third failed request: Issuing false, Failed.
  const failing = (attempts: number | undefined, lastFailure: number) =>
    variantOf(certificateNamed("never-issued"), (raw) => {
      raw.status.lastFailureTime = new Date(lastFailure).toISOString().replace(/\.\d+Z$/, "Z");
      if (attempts === undefined) delete raw.status.failedIssuanceAttempts;
      else raw.status.failedIssuanceAttempts = attempts;
      for (const condition of raw.status.conditions) {
        if (condition.type === "Issuing") {
          condition.status = "False";
          condition.reason = "Failed";
        }
      }
    });

  it("waits an hour after the first, doubling each time, never more than 32 hours", () => {
    expect([1, 2, 3, 6, 7, 20].map((attempts) => backoffAfter(attempts) / HOUR)).toEqual([
      1, 2, 4, 32, 32, 32,
    ]);
  });

  it("reads nothing for a certificate that never failed", () => {
    expect(issuanceFailuresOf(certificateNamed("web-tls"))).toBeUndefined();
    expect(issuanceFailuresOf(certificateNamed("never-issued"))).toBeUndefined();
  });

  it("reads the attempts and when cert-manager tries next", () => {
    const last = now - 30 * 60 * 1000;

    expect(issuanceFailuresOf(failing(3, last))).toEqual({
      attempts: 3,
      lastFailure: last,
      nextTry: last + 4 * HOUR,
    });
  });

  it("reads out-of-date's failed issues, waiting as long as its attempts call for", () => {
    const real = certificateNamed("out-of-date");
    const lastFailure = Date.parse(real.status?.lastFailureTime ?? "");

    expect(real.status?.failedIssuanceAttempts).toBe(2);
    expect(issuanceFailuresOf(real)).toEqual({
      attempts: 2,
      lastFailure,
      nextTry: lastFailure + backoffAfter(2),
    });
  });

  it("tells Renew now on out-of-date that it skips cert-manager's wait", () => {
    const verdict = verdictOf("out-of-date");

    expect(verdict).toEqual({ offer: true });
    expect(renewNowNote(verdict, issuanceFailuresOf(certificateNamed("out-of-date")), now)).toBe(
      "Renewing now tries at once, without waiting for cert-manager's next try.",
    );
  });

  it("waits an hour when only the failure time is recorded, as older cert-manager does", () => {
    const last = now - 30 * 60 * 1000;

    expect(issuanceFailuresOf(failing(undefined, last))).toMatchObject({
      attempts: 1,
      nextTry: last + HOUR,
    });
  });

  it("says how many failed, when, and when the next try is", () => {
    const failures = issuanceFailuresOf(failing(3, now - 30 * 60 * 1000));

    expect(failures && describeFailures(failures, now)).toBe(
      "3 failed attempts, the last 30 minutes ago. cert-manager tries again in 3 hours, or sooner if its spec changes.",
    );
  });

  it("says the wait is over once the next try is past", () => {
    const failures = issuanceFailuresOf(failing(1, now - 2 * HOUR));

    expect(failures && describeFailures(failures, now)).toMatch(
      /^1 failed attempt, the last .* ago\. The wait is over/,
    );
  });

  it("tells Renew now that it skips the wait, after the broken issuer's warning", () => {
    const certificate = failing(3, now - 30 * 60 * 1000);
    const verdict = renewalVerdict(certificate, explanationOf(chainOf(certificate, inputs)));
    const note = renewNowNote(verdict, issuanceFailuresOf(certificate), now);

    expect(verdict.offer).toBe(true);
    expect(note).toMatch(/^Its issuer is not usable \(Issuer broken-ca\).*without waiting/);
  });

  it("keeps Renew now as it was without a wait to skip", () => {
    const healthy = verdictOf("web-tls");
    const waited = issuanceFailuresOf(failing(1, now - 2 * HOUR));

    expect(renewNowNote(healthy, undefined, now)).toBe("Offered in the title bar.");
    expect(renewNowNote(healthy, waited, now)).toBe("Offered in the title bar.");
    expect(renewNowNote(verdictOf("acme-web"), undefined, now)).toMatch(/already issuing/);
  });
});
