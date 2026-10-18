import { describe, expect, it } from "vitest";

import {
  certificateNames,
  certificateSearchTexts,
  certificatesEmptyText,
  FILTER_LABELS,
  isCertificateFilter,
  matchesFilter,
  matchesSearch,
  selectCertificates,
} from "../../src/renderer/api/certificates/certificate-filter";
import { certificateNamed, certificates, fixtureNow, variantOf } from "../support/fixtures";

const now = fixtureNow();
const names = (filter: Parameters<typeof matchesFilter>[1]) =>
  certificates()
    .filter((certificate) => matchesFilter(certificate, filter, now))
    .map((certificate) => certificate.getName())
    .sort();

describe("the chips", () => {
  it("knows its own filters and nothing else", () => {
    for (const filter of Object.keys(FILTER_LABELS)) expect(isCertificateFilter(filter)).toBe(true);
    expect(isCertificateFilter("everything")).toBe(false);
  });

  it("shows every certificate under All", () => {
    expect(names("all")).toHaveLength(certificates().length);
  });

  it("shows the attention list's certificates under Needs attention", () => {
    expect(names("attention")).toEqual([
      "acme-web",
      "never-issued",
      "orphan",
      "out-of-date",
      "renewal-stalls",
    ]);
  });

  it("shows the ones ending within the month", () => {
    expect(names("expiring")).toEqual(["ends-this-month", "ends-this-week"]);
  });

  it("shows only the failing renewal under Renewal failing", () => {
    expect(names("failing")).toEqual(["renewal-stalls"]);
  });

  it("shows the ones with nothing to serve under Not ready", () => {
    expect(names("not-ready")).toEqual(["acme-web", "never-issued", "orphan"]);
  });
});

describe("the search field", () => {
  it("matches a hostname, which is what someone arriving from an alert has", () => {
    expect(matchesSearch(certificateNamed("acme-web"), "acme.demo.test")).toBe(true);
  });

  it("matches the issuer, the Secret and the namespace", () => {
    expect(matchesSearch(certificateNamed("acme-web"), "pebble")).toBe(true);
    expect(matchesSearch(certificateNamed("web-tls"), "WEB-TLS")).toBe(true);
    expect(matchesSearch(certificateNamed("demo-ca-root"), "cert-manager")).toBe(true);
    expect(matchesSearch(certificateNamed("demo-ca-root"), "demo-ca")).toBe(true);
  });

  it("matches everything when empty, and nothing that is not there", () => {
    expect(matchesSearch(certificateNamed("orphan"), "   ")).toBe(true);
    expect(matchesSearch(certificateNamed("orphan"), "no-such-thing")).toBe(false);
  });
});

describe("what the picker lists", () => {
  it("filters, searches, and orders by urgency", () => {
    const selected = selectCertificates(certificates(), "attention", "demo", now).map((each) =>
      each.getName(),
    );

    expect(selected).toEqual([
      "acme-web",
      "never-issued",
      "orphan",
      "out-of-date",
      "renewal-stalls",
    ]);
  });

  it("is empty when the search finds nothing under the chip", () => {
    expect(selectCertificates(certificates(), "failing", "acme", now)).toEqual([]);
  });
});

describe("what the list's search reads", () => {
  it("is the name, namespace, Secret, issuer and every DNS name", () => {
    const texts = certificateSearchTexts(certificateNamed("acme-web"));

    expect(texts).toEqual(expect.arrayContaining(["acme-web", "demo", "pebble", "acme.demo.test"]));
  });
});

describe("the certificates page's empty text", () => {
  it("does not say there is no Certificate when the list was refused", () => {
    expect(certificatesEmptyText("ready", false, 0)).toBe(
      "Not known: the Certificates could not be listed.",
    );
  });

  it("says why it is empty once the list is known", () => {
    expect(certificatesEmptyText("connecting", true, 0)).toBe("Connecting to the cluster…");
    expect(certificatesEmptyText("ready", true, 0)).toBe(
      "There is no Certificate in the namespaces chosen in the selector.",
    );
    expect(certificatesEmptyText("ready", true, certificates().length)).toBe(
      "No certificate matches that filter.",
    );
  });
});

describe("the names a certificate is shown under", () => {
  const named = (change: (raw: { spec: { dnsNames?: string[]; commonName?: string } }) => void) =>
    variantOf(certificateNamed("web-tls"), change);

  it("lists its DNS names, else its common name, else a dash", () => {
    expect(
      certificateNames(
        named((raw) => {
          raw.spec.dnsNames = ["a.example", "b.example"];
        }),
      ),
    ).toBe("a.example, b.example");
    expect(
      certificateNames(
        named((raw) => {
          delete raw.spec.dnsNames;
          raw.spec.commonName = "cn.example";
        }),
      ),
    ).toBe("cn.example");
    expect(
      certificateNames(
        named((raw) => {
          delete raw.spec.dnsNames;
          delete raw.spec.commonName;
        }),
      ),
    ).toBe("—");
  });
});
