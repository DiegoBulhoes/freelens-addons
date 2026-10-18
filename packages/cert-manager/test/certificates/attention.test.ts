import { describe, expect, it } from "vitest";

import {
  certificateStatusOf,
  certificateVerdict,
  compareByUrgency,
  describeHeadline,
  getAttentionItems,
  problemOf,
  problemSeverity,
} from "../../src/renderer/api/certificates/attention";
import { matchesFilter } from "../../src/renderer/api/certificates/certificate-filter";
import {
  type ChainInputs,
  chainOf,
  explanationOf,
} from "../../src/renderer/api/certificates/chain";
import { ALARM_DAYS } from "../../src/renderer/api/certificates/expiry";
import {
  certificateNamed,
  certificateRequests,
  certificates,
  challenges,
  fixtureNow,
  issuerIndex,
  orders,
  variantOf,
} from "../support/fixtures";

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
    const certificate = certificateNamed("web-tls");

    expect(problemSeverity(certificate, "expired", now)).toBe("critical");
    expect(problemSeverity(certificate, "not-ready", now)).toBe("critical");
    expect(problemSeverity(certificate, "renewal-overdue", now)).toBe("warning");
  });
});

describe("the attention list", () => {
  const items = getAttentionItems(certificates(), now);

  it("holds exactly the stuck certificates", () => {
    expect(items.map((item) => item.certificate.getName()).sort()).toEqual([
      "acme-web",
      "never-issued",
      "orphan",
      "out-of-date",
      "renewal-stalls",
    ]);
  });

  it("puts the critical ones first", () => {
    expect(items.map((item) => item.severity)).toEqual([
      "critical",
      "critical",
      "critical",
      "warning",
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
    expect(describeHeadline(4, 9)).toBe("4 of 9 certificates need attention");
    expect(describeHeadline(1, 1)).toBe("1 of 1 certificate needs attention");
  });

  it("says so when everything is fine, and when there is nothing", () => {
    expect(describeHeadline(0, 9)).toBe("All 9 certificates are fine");
    expect(describeHeadline(0, 1)).toBe("All 1 certificate is fine");
    expect(describeHeadline(0, 0)).toBe("No certificates");
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

describe("the state a certificate's drawer opens with", () => {
  const inputs: ChainInputs = {
    index: issuerIndex(),
    requests: certificateRequests(),
    orders: orders(),
    challenges: challenges(),
  };
  const verdictOf = (name: string) => {
    const certificate = certificateNamed(name);

    return certificateVerdict(certificate, explanationOf(chainOf(certificate, inputs)), now);
  };

  it("says a healthy one is ready, how long it has and when it renews", () => {
    const verdict = verdictOf("web-tls");

    expect(verdict).toMatchObject({ tone: "ok", label: "Ready" });
    expect(verdict.reason).toMatch(/^Ready, \d+ \w+ left\. Renewal due in \d+ \w+\.$/);
  });

  it("leaves the renewal out when cert-manager has not set one", () => {
    const bare = variantOf(certificateNamed("web-tls"), (raw) => {
      delete raw.status.renewalTime;
    });

    expect(certificateVerdict(bare, undefined, now).reason).toMatch(/^Ready, \d+ \w+ left\.$/);
  });

  it("names a failing renewal, and the link in the chain that explains it", () => {
    const verdict = verdictOf("renewal-stalls");

    expect(verdict.tone).toBe("warning");
    expect(verdict.label).toMatch(/renewal is failing/);
    expect(verdict.reason).toMatch(/^Issuer flaky-ca: /);
  });

  it("calls one with nothing to serve critical", () => {
    expect(verdictOf("orphan")).toMatchObject({
      tone: "critical",
      label: "Not ready: there is no certificate to serve.",
    });
  });

  it("falls back to its Ready condition's message when no link explains it", () => {
    const orphan = certificateNamed("orphan");
    const message = orphan.status?.conditions?.find((each) => each.type === "Ready")?.message;

    expect(message).toBeTruthy();
    expect(certificateVerdict(orphan, undefined, now).reason).toBe(message);
  });

  it("says nothing explains it when nothing does", () => {
    const silent = variantOf(certificateNamed("orphan"), (raw) => {
      raw.status.conditions = [];
    });

    expect(certificateVerdict(silent, undefined, now).reason).toBe(
      "Nothing in its chain says why.",
    );
  });

  it("calls an expired one expired", () => {
    const certificate = certificateNamed("ends-this-week");

    expect(certificateVerdict(certificate, undefined, now + ALARM_DAYS * DAY)).toMatchObject({
      tone: "critical",
      label: "Expired. Clients reject it.",
    });
  });
});

// A spec edit leaves Ready false while the previous certificate is still in the Secret.
const outOfDate = (name: string) =>
  variantOf(certificateNamed(name), (raw) => {
    raw.status.conditions = [
      {
        type: "Ready",
        status: "False",
        reason: "DoesNotMatch",
        message: "Existing issued Secret is not up to date for spec: [spec.dnsNames]",
      },
      { type: "Issuing", status: "True", reason: "Reissuing", message: "Issuing certificate" },
    ];
  });

describe("a certificate whose previous issue is still served", () => {
  it("is out of date, not without a certificate", () => {
    expect(problemOf(outOfDate("web-tls"), now)).toBe("out-of-date");
    expect(problemOf(certificateNamed("never-issued"), now)).toBe("not-ready");
  });

  it("is out-of-date as the seed leaves it: its new issue failed, the old one still valid", () => {
    const real = certificateNamed("out-of-date");

    expect(problemOf(real, now)).toBe("out-of-date");
    expect(problemSeverity(real, "out-of-date", now)).toBe("warning");
    expect(matchesFilter(real, "not-ready", now)).toBe(false);
  });

  it("is a warning while what it serves lasts, and critical within the alarm window", () => {
    expect(problemSeverity(outOfDate("web-tls"), "out-of-date", now)).toBe("warning");
    expect(problemSeverity(outOfDate("ends-this-week"), "out-of-date", now)).toBe("critical");
    expect(certificateStatusOf(outOfDate("web-tls"), now)).toEqual({
      label: "Out of date",
      tone: "warning",
    });
  });

  it("is expired once that ends", () => {
    expect(problemOf(outOfDate("ends-this-week"), now + ALARM_DAYS * DAY)).toBe("expired");
  });

  it("says the previous one is still served, and for how long", () => {
    const verdict = certificateVerdict(outOfDate("web-tls"), undefined, now);

    expect(verdict.tone).toBe("warning");
    expect(verdict.label).toMatch(/^Out of date: .*previous one is still served, \d+ days left\.$/);
    expect(verdict.reason).toMatch(/not up to date for spec/);
  });

  it("is listed under Out of date and Needs attention, not under Not ready", () => {
    const certificate = outOfDate("web-tls");

    expect(matchesFilter(certificate, "out-of-date", now)).toBe(true);
    expect(matchesFilter(certificate, "attention", now)).toBe(true);
    expect(matchesFilter(certificate, "not-ready", now)).toBe(false);
    expect(getAttentionItems([certificate], now)[0]).toMatchObject({
      problem: "out-of-date",
      severity: "warning",
      headline: "Out of date",
    });
  });
});
