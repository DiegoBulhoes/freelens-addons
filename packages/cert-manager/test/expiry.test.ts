import { describe, expect, it } from "vitest";

import {
  ALARM_DAYS,
  conditionOf,
  describeDuration,
  describeMoment,
  describeTimeLeft,
  EXPIRING_DAYS,
  expiresWithin,
  formatUtc,
  isExpired,
  isReady,
  isRenewalOverdue,
  RENEWAL_GRACE_MS,
  timeLeft,
  validityOf,
} from "../src/renderer/api/expiry";
import { certificateNamed, fixtureNow, variantOf } from "./fixtures";

/**
 * Every question about a certificate's time, asked at the moment the fixtures
 * were exported. Moving `now` is how the tests reach the states the cluster only
 * passes through — expired, still inside the renewal grace — without inventing
 * an object for them.
 */

const DAY = 24 * 60 * 60 * 1000;
const now = fixtureNow();

describe("readiness", () => {
  it("reads the Ready condition, and nothing else", () => {
    expect(isReady(certificateNamed("web-tls"))).toBe(true);
    expect(isReady(certificateNamed("orphan"))).toBe(false);
  });

  it("has no answer for a condition the object does not carry", () => {
    expect(conditionOf(certificateNamed("web-tls"), "Issuing")).toBeUndefined();
  });
});

describe("time left", () => {
  it("is undefined for a certificate that was never issued, not zero", () => {
    expect(timeLeft(certificateNamed("never-issued"), now)).toBeUndefined();
  });

  it("counts down to notAfter", () => {
    const left = timeLeft(certificateNamed("ends-this-week"), now) ?? 0;

    expect(left).toBeGreaterThan(5 * DAY);
    expect(left).toBeLessThan(ALARM_DAYS * DAY);
  });

  it("treats a timestamp that does not parse as absent", () => {
    const garbled = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.status.notAfter = "not a date";
    });

    expect(timeLeft(garbled, now)).toBeUndefined();
  });
});

describe("expiry", () => {
  it("holds nothing expired at export", () => {
    expect(isExpired(certificateNamed("ends-this-week"), now)).toBe(false);
  });

  it("calls a certificate expired once notAfter has passed", () => {
    expect(isExpired(certificateNamed("ends-this-week"), now + ALARM_DAYS * DAY)).toBe(true);
  });

  it("never calls a certificate with no notAfter expired", () => {
    expect(isExpired(certificateNamed("orphan"), now + 365 * DAY)).toBe(false);
  });

  it("puts each certificate in the window it ends in", () => {
    expect(expiresWithin(certificateNamed("ends-this-week"), now, ALARM_DAYS)).toBe(true);
    expect(expiresWithin(certificateNamed("ends-this-month"), now, ALARM_DAYS)).toBe(false);
    expect(expiresWithin(certificateNamed("ends-this-month"), now, EXPIRING_DAYS)).toBe(true);
    expect(expiresWithin(certificateNamed("web-tls"), now, EXPIRING_DAYS)).toBe(false);
  });

  it("does not call an expired certificate expiring", () => {
    expect(expiresWithin(certificateNamed("ends-this-week"), now + ALARM_DAYS * DAY, 30)).toBe(
      false,
    );
  });
});

describe("a renewal that is failing while the certificate is still valid", () => {
  const stalls = certificateNamed("renewal-stalls");
  const renewal = Date.parse(stalls.status?.renewalTime ?? "");

  it("is overdue once the grace has passed, with Ready still true", () => {
    expect(isReady(stalls)).toBe(true);
    expect(isRenewalOverdue(stalls, now)).toBe(true);
  });

  it("is not overdue inside the grace, when it may simply be in progress", () => {
    expect(isRenewalOverdue(stalls, renewal + RENEWAL_GRACE_MS - 1000)).toBe(false);
  });

  it("stops being overdue and becomes expired once notAfter passes", () => {
    expect(isRenewalOverdue(stalls, now + 2 * DAY)).toBe(false);
    expect(isExpired(stalls, now + 2 * DAY)).toBe(true);
  });

  it("does not apply to a certificate whose renewal is still ahead", () => {
    expect(isRenewalOverdue(certificateNamed("web-tls"), now)).toBe(false);
  });

  it("does not apply to one that is not ready — that is a different problem", () => {
    expect(isRenewalOverdue(certificateNamed("orphan"), now)).toBe(false);
  });
});

describe("the validity window", () => {
  it("does not exist before the first issue", () => {
    expect(validityOf(certificateNamed("acme-web"), now)).toBeUndefined();
  });

  it("places now and the renewal time on the certificate's lifetime", () => {
    const validity = validityOf(certificateNamed("renewal-stalls"), now);

    expect(validity?.position).toBeGreaterThan(0);
    expect(validity?.position).toBeLessThan(0.1);
    // Renewal three minutes into a day-long certificate.
    expect(validity?.renewalPosition).toBeLessThan(0.01);
  });

  it("clamps to the ends rather than drawing off the bar", () => {
    expect(validityOf(certificateNamed("ends-this-week"), now + 30 * DAY)?.position).toBe(1);
    expect(validityOf(certificateNamed("ends-this-week"), 0)?.position).toBe(0);
  });

  it("has no renewal mark when the certificate has no renewal time", () => {
    const unscheduled = variantOf(certificateNamed("web-tls"), (raw) => {
      delete raw.status.renewalTime;
    });

    expect(validityOf(unscheduled, now)?.renewalPosition).toBeUndefined();
  });

  it("does not divide by a lifetime of nothing", () => {
    const instant = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.status.notAfter = raw.status.notBefore;
    });

    expect(validityOf(instant, now)?.position).toBe(1);
  });
});

describe("how time reads", () => {
  it("uses the largest whole unit, in the right number", () => {
    expect(describeDuration(6 * DAY + 5000)).toBe("6 days");
    expect(describeDuration(DAY)).toBe("1 day");
    expect(describeDuration(3 * 60 * 60 * 1000)).toBe("3 hours");
    expect(describeDuration(60 * 1000)).toBe("1 minute");
    expect(describeDuration(30 * 1000)).toBe("less than a minute");
    expect(describeDuration(-2 * DAY)).toBe("2 days");
  });

  it("says what a row should say", () => {
    expect(describeTimeLeft(certificateNamed("orphan"), now)).toBe("never issued");
    expect(describeTimeLeft(certificateNamed("ends-this-week"), now)).toMatch(/^\d+ days? left$/);
    expect(describeTimeLeft(certificateNamed("ends-this-week"), now + ALARM_DAYS * DAY)).toMatch(
      /^expired .+ ago$/,
    );
  });
});

describe("the dates under the validity bar", () => {
  const at = Date.UTC(2026, 8, 27, 21, 57, 30, 450);

  it("writes a moment in UTC, to the minute", () => {
    expect(formatUtc(at)).toBe("2026-09-27 21:57 UTC");
  });

  it("says how far a moment is from now, either way", () => {
    expect(describeMoment(at + 5 * DAY, at)).toBe("in 5 days");
    expect(describeMoment(at - 3 * 60 * 60 * 1000, at)).toBe("3 hours ago");
  });

  it("calls anything within a minute now, rather than zero of a unit", () => {
    expect(describeMoment(at + 20 * 1000, at)).toBe("now");
    expect(describeMoment(at - 59 * 1000, at)).toBe("now");
  });
});
