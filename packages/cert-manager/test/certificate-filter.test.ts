import { describe, expect, it } from "vitest";

import {
  certificateSearchTexts,
  FILTER_LABELS,
  isCertificateFilter,
  matchesFilter,
  matchesSearch,
  selectCertificates,
} from "../src/renderer/api/certificate-filter";
import { certificateNamed, certificates, fixtureNow } from "./fixtures";

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
    expect(names("attention")).toEqual(["acme-web", "never-issued", "orphan", "renewal-stalls"]);
  });

  it("shows the ones ending within the month, the stalled one included", () => {
    expect(names("expiring")).toEqual(["ends-this-month", "ends-this-week", "renewal-stalls"]);
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

    expect(selected).toEqual(["acme-web", "never-issued", "orphan", "renewal-stalls"]);
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
