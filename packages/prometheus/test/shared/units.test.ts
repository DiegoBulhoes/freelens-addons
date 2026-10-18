import { describe, expect, it } from "vitest";

import {
  describeAgainst,
  describeShare,
  describeUsage,
  describeValue,
  formatBytes,
  formatCores,
  formatPercent,
  formatRate,
  NO_DATA,
} from "../../src/renderer/api/shared/units";

describe("units", () => {
  it("bytes in binary units, one decimal below 100", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(240173056)).toBe("229 MiB");
    expect(formatBytes(2011859927040)).toBe("1.8 TiB");
    expect(formatBytes(2 ** 60)).toBe("1024 PiB");
    expect(formatBytes(-2048)).toBe("-2 KiB");
    expect(formatRate(43455)).toBe("42.4 KiB/s");
  });

  it("cores as millicores below one", () => {
    expect(formatCores(0.0071)).toBe("7m");
    expect(formatCores(0.5)).toBe("500m");
    expect(formatCores(1.17577)).toBe("1.18");
    expect(formatCores(16)).toBe("16");
    expect(formatPercent(0.734)).toBe("73%");
  });

  it("a missing usage is no data, never 0", () => {
    expect(describeShare(undefined, 16, formatCores)).toBe(NO_DATA);
    expect(describeShare(0, 16, formatCores)).toBe("0m of 16 · 0%");
    expect(describeShare(2, undefined, formatCores)).toBe("2");
    expect(describeShare(2, 0, formatCores)).toBe("2");
    expect(describeValue(undefined, formatRate)).toBe(NO_DATA);
    expect(describeValue(0, formatRate)).toBe("0 B/s");
  });

  it("usage beside the request and limit that are set", () => {
    expect(describeUsage(0.007, 0.06, undefined, formatCores)).toBe("7m · req 60m");
    expect(describeAgainst(0.007, 0.06, undefined, formatCores)).toBe("7m · 12% req");
    expect(describeAgainst(2 ** 29, 2 ** 28, 2 ** 30, formatBytes)).toBe("512 MiB · 50% lim");
    expect(describeAgainst(0.5, undefined, undefined, formatCores)).toBe("500m");
    expect(describeAgainst(undefined, 1, 1, formatCores)).toBe(NO_DATA);
    expect(describeUsage(undefined, undefined, 2 ** 20, formatBytes)).toBe(
      `${NO_DATA} · lim 1 MiB`,
    );
    expect(describeUsage(1024, 512, 2048, formatBytes)).toBe("1 KiB · req 512 B · lim 2 KiB");
  });
});
