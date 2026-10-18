import { describe, expect, it } from "vitest";

import { describeHeadline } from "../../src/renderer/api/certificates/attention";
import {
  type ChainInputs,
  chainOf,
  explanationOf,
} from "../../src/renderer/api/certificates/chain";
import {
  describeIssuersHeadline,
  type IssuerIndex,
  summariseIssuers,
} from "../../src/renderer/api/issuers/issuers";
import { bannerFailures, listingBanner } from "../../src/renderer/api/shared/listing";
import { renewalVerdict } from "../../src/renderer/api/writes/renewal";
import {
  certificateNamed,
  certificateRequests,
  certificates,
  challenges,
  issuers,
  orders,
} from "../support/fixtures";

// A refused list leaves its store loaded and empty: what it holds is unknown, not absent.
const refusedClusterIssuers: IssuerIndex = {
  issuers: issuers(),
  clusterIssuers: [],
  unlisted: new Set(["ClusterIssuer"]),
};

describe("issuers of a kind that could not be listed", () => {
  const summary = summariseIssuers(refusedClusterIssuers, certificates());
  const entryOf = (name: string) => summary.entries.find((each) => each.name === name);

  it("are unknown, not missing", () => {
    expect(entryOf("demo-ca")?.state).toMatchObject({ tone: "info", label: "Unknown" });
    expect(entryOf("demo-ca")?.state.reason).toMatch(/ClusterIssuers could not be listed/);
    expect(summary.missing).toEqual([]);
  });

  it("still carry the certificates that name them", () => {
    expect(entryOf("demo-ca")?.dependents.map((each) => each.getName())).toContain("web-tls");
  });

  it("leave the kinds that were listed judged as before", () => {
    expect(entryOf("broken-ca")?.state).toMatchObject({ tone: "critical" });
    expect(entryOf("selfsigned-issuer")?.state).toMatchObject({ tone: "ok" });
  });

  it("are counted as not checked in the headline, not as failing", () => {
    const ready = summary.rows.filter((row) => row.ready);

    expect(describeIssuersHeadline(ready, [], summary.unknown)).toBe(
      `${summary.unknown.length} of ${ready.length + summary.unknown.length} issuers could not be checked; the rest are ready`,
    );
    expect(summary.headline).toMatch(/are not ready or missing$/);
  });

  it("show as unknown in the chain, and are never named the cause", () => {
    const inputs: ChainInputs = {
      index: refusedClusterIssuers,
      requests: certificateRequests(),
      orders: orders(),
      challenges: challenges(),
    };
    const chain = chainOf(certificateNamed("web-tls"), inputs);

    expect(chain[0]).toMatchObject({ kind: "ClusterIssuer", name: "demo-ca", state: "unknown" });
    expect(explanationOf(chain)).toBeUndefined();
    expect(renewalVerdict(certificateNamed("web-tls"), explanationOf(chain))).toEqual({
      offer: true,
    });
  });
});

describe("the overview when Certificates could not be listed", () => {
  it("does not say every certificate is fine", () => {
    expect(describeHeadline(0, 0, false)).toBe("Certificates could not be listed");
    expect(describeHeadline(0, 0)).toBe("No certificates");
  });
});

describe("the banner for what could not be listed", () => {
  it("names each kind refused, in the plural", () => {
    expect(listingBanner({ failed: ["ClusterIssuer"], gaveUp: false })?.title).toBe(
      "ClusterIssuers could not be listed.",
    );
    expect(
      listingBanner({ failed: ["Certificate", "CertificateRequest", "Challenge"], gaveUp: false })
        ?.title,
    ).toBe("Certificates, CertificateRequests and Challenges could not be listed.");
  });

  it("names refused Ingresses in their own plural, beside cert-manager's kinds", () => {
    expect(listingBanner({ failed: ["Order", "Ingress"], gaveUp: false })?.title).toBe(
      "Orders and Ingresses could not be listed.",
    );
  });

  it("says the lists did not arrive when the retries ran out", () => {
    expect(listingBanner({ failed: [], gaveUp: true })?.title).toBe(
      "cert-manager's objects did not load.",
    );
  });

  it("is absent when everything was listed", () => {
    expect(listingBanner({ failed: [], gaveUp: false })).toBeUndefined();
  });
});

describe("the kinds the banner names", () => {
  it("adds Ingress when its list was refused, and nothing otherwise", () => {
    expect(bannerFailures(["Order"], { refused: true })).toEqual(["Order", "Ingress"]);
    expect(bannerFailures(["Order"], { refused: false })).toEqual(["Order"]);
  });
});
