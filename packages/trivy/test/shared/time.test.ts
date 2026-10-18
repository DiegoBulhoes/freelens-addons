import { describe, expect, it } from "vitest";

import { describeAge, formatTime } from "../../src/renderer/api/shared/time";
import { vulnerabilityReports } from "../support/fixtures";

const scannedAt = () => {
  const at = vulnerabilityReports()[0]?.report?.updateTimestamp;

  if (!at) throw new Error("the fixture report lost its updateTimestamp");

  return at;
};

describe("showing when a report was written", () => {
  it("gives a fact the local date and time, not the operator's ISO text", () => {
    const at = scannedAt();

    expect(formatTime(at)).toBe(new Date(Date.parse(at)).toLocaleString());
    expect(formatTime(at)).not.toBe(at);
  });

  it("shows a dash when there is no time, and text it cannot read as it is", () => {
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("")).toBe("—");
    expect(formatTime("yesterday")).toBe("yesterday");
  });

  it("puts the age beside it, relative to now", () => {
    const at = scannedAt();
    const now = Date.parse(at) + 2 * 60 * 60_000;

    expect(describeAge(at, now)).toBe("2 hours ago");
    expect(describeAge(at, Date.parse(at) - 60_000)).toBe("less than a minute ago");
  });

  it("gives no age for a time it does not have or cannot read", () => {
    expect(describeAge(undefined, Date.now())).toBeUndefined();
    expect(describeAge("yesterday", Date.now())).toBeUndefined();
  });
});
