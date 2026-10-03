import { describe, expect, it } from "vitest";

import {
  certificateStatusOf,
  compareByUrgency,
  getAttentionItems,
  headlineOf,
  problemOf,
  severityOf,
} from "../src/renderer/api/attention";
import { ALARM_DAYS } from "../src/renderer/api/expiry";
import { certificateNamed, certificates, fixtureNow } from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;
const now = fixtureNow();

describe("what counts as a problem", () => {
  it("names each stuck certificate by what is wrong with it", () => {
    expect(problemOf(certificateNamed("orphan"), now)).toBe("not-ready");
    expect(problemOf(certificateNamed("never-issued"), now)).toBe("not-ready");
    expect(problemOf(certificateNamed("acme-web"), now)).toBe("not-ready");
    expect(problemOf(certificateNamed("renewal-stalls"), now)).toBe("renewal-overdue");
  });

  it("calls a certificate that ends this week, on schedule, fine", () => {
    // Renewal is due a day before the end and has not come round yet: nothing to do.
    expect(problemOf(certificateNamed("ends-this-week"), now)).toBeUndefined();
    expect(problemOf(certificateNamed("web-tls"), now)).toBeUndefined();
  });

  it("calls it expired once it is", () => {
    expect(problemOf(certificateNamed("ends-this-week"), now + ALARM_DAYS * DAY)).toBe("expired");
  });

  it("ranks broken now above broken later", () => {
    expect(severityOf("expired")).toBe("critical");
    expect(severityOf("not-ready")).toBe("critical");
    expect(severityOf("renewal-overdue")).toBe("warning");
  });
});

describe("the attention list", () => {
  const items = getAttentionItems(certificates(), now);

  it("holds exactly the stuck certificates", () => {
    expect(items.map((item) => item.certificate.getName()).sort()).toEqual([
      "acme-web",
      "never-issued",
      "orphan",
      "renewal-stalls",
    ]);
  });

  it("puts the critical ones first", () => {
    expect(items.map((item) => item.severity)).toEqual([
      "critical",
      "critical",
      "critical",
      "warning",
    ]);
  });

  it("says why, in the certificate's own words", () => {
    const stalls = items.find((item) => item.problem === "renewal-overdue");
    const orphan = items.find((item) => item.certificate.getName() === "orphan");

    // For the overdue one the Ready condition says all is well; Issuing says what is not.
    expect(stalls?.detail).toMatch(/Renewing certificate as renewal was scheduled/);
    expect(orphan?.detail).toMatch(/Secret does not exist/);
    expect(stalls?.headline).toBe("Renewal failing");
  });

  it("puts expired above not ready, and less time left above more", () => {
    const later = now + ALARM_DAYS * DAY;
    const ranked = getAttentionItems(certificates(), later).map((item) => item.problem);

    expect(ranked.indexOf("expired")).toBeLessThan(ranked.indexOf("not-ready"));
  });
});

describe("ordering by urgency", () => {
  it("orders the healthy ones by how soon they end", () => {
    const fine = ["web-tls", "ends-this-month", "ends-this-week"].map(certificateNamed);
    const ordered = [...fine].sort(compareByUrgency(now)).map((each) => each.getName());

    expect(ordered).toEqual(["ends-this-week", "ends-this-month", "web-tls"]);
  });

  it("gives opposite answers for opposite pairs, which a subtraction of infinities did not", () => {
    const compare = compareByUrgency(now);
    const week = certificateNamed("ends-this-week");
    const month = certificateNamed("ends-this-month");
    const orphan = certificateNamed("orphan");
    const never = certificateNamed("never-issued");

    expect(compare(week, month)).toBeLessThan(0);
    expect(compare(month, week)).toBeGreaterThan(0);
    // Both never issued: equal on time left, so the name decides — both ways round.
    expect(Math.sign(compare(orphan, never))).toBe(-Math.sign(compare(never, orphan)));
    expect(compare(orphan, never)).not.toBeNaN();
  });

  it("falls back to namespace and name when nothing else separates them", () => {
    const ordered = ["orphan", "never-issued", "acme-web"]
      .map(certificateNamed)
      .sort(compareByUrgency(now))
      .map((each) => each.getName());

    expect(ordered).toEqual(["acme-web", "never-issued", "orphan"]);
  });
});

describe("the headline", () => {
  it("counts what needs attention out of everything", () => {
    expect(headlineOf(4, 9)).toBe("4 of 9 certificates need attention");
    expect(headlineOf(1, 1)).toBe("1 of 1 certificate needs attention");
  });

  it("says so when everything is fine, and when there is nothing", () => {
    expect(headlineOf(0, 9)).toBe("All 9 certificates are fine");
    expect(headlineOf(0, 1)).toBe("All 1 certificate is fine");
    expect(headlineOf(0, 0)).toBe("No certificates");
  });
});

describe("a certificate's state, as a dot and a word", () => {
  it("is its problem, in the problem's tone", () => {
    expect(certificateStatusOf(certificateNamed("orphan"), now)).toEqual({
      label: "Not ready",
      tone: "critical",
    });
    expect(certificateStatusOf(certificateNamed("renewal-stalls"), now)).toEqual({
      label: "Renewal failing",
      tone: "warning",
    });
  });

  it("is Ready for a certificate with nothing wrong, even one ending this week", () => {
    expect(certificateStatusOf(certificateNamed("ends-this-week"), now)).toEqual({
      label: "Ready",
      tone: "ok",
    });
  });
});
