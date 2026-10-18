import { describe, expect, it } from "vitest";
import { getScanProgress } from "../../src/renderer/api/overview/scan-progress";
import { VulnerabilityReport } from "../../src/renderer/api/shared/kinds";
import {
  DEFAULT_RESCAN_MS,
  parseGoDuration,
  rescanIntervalOf,
  TTL_ANNOTATION,
} from "../../src/renderer/api/workloads/report-ttl";
import { getWorkloadRows } from "../../src/renderer/api/workloads/workload-rows";
import vulnerabilityJson from "../fixtures/vulnerability-reports.json";
import {
  configAuditReports,
  exposedSecretReports,
  fixtureNow,
  reportNamed,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

const HOUR = 60 * 60 * 1000;

type RawReport = { metadata: { name: string; annotations?: Record<string, string> } };

// The exported reports, with the operator's report-ttl set to `ttl` (or `ttlOf` by name), or removed.
function reportsWithTtl(
  ttl: string | undefined,
  ttlOf: (name: string) => string | undefined = () => ttl,
): VulnerabilityReport[] {
  return (vulnerabilityJson as unknown as { items: RawReport[] }).items.map((item) => {
    const { [TTL_ANNOTATION]: _dropped, ...others } = item.metadata.annotations ?? {};
    const wanted = ttlOf(item.metadata.name);
    const annotations = wanted === undefined ? others : { ...others, [TTL_ANNOTATION]: wanted };

    return new VulnerabilityReport({
      ...item,
      metadata: { ...item.metadata, annotations },
    } as never);
  });
}

function staleAt(
  now: number,
  ttl: string | undefined,
  ttlOf?: (name: string) => string | undefined,
) {
  const rows = getWorkloadRows({
    vulnerabilityReports: reportsWithTtl(ttl, ttlOf),
    sbomReports: sbomReports(),
    configAuditReports: configAuditReports(),
    exposedSecretReports: exposedSecretReports(),
  });

  return {
    stale: getScanProgress(rows, now).staleCount,
    dated: rows.filter((row) => row.scannedAt !== undefined).length,
  };
}

describe("reading the operator's report-ttl", () => {
  it.each([
    ["24h0m0s", 24 * HOUR],
    ["72h", 72 * HOUR],
    ["1h30m", 1.5 * HOUR],
    ["1.5h", 1.5 * HOUR],
    ["90m0s", 1.5 * HOUR],
    ["500ms", 500],
    ["0s", 0],
    ["0", 0],
  ])("reads %j as Go does", (text, expected) => {
    expect(parseGoDuration(text)).toBe(expected);
  });

  it.each(["", "24", "h", "1d", "-1h", "24h junk", "1h-30m"])("refuses %j", (text) => {
    expect(parseGoDuration(text)).toBeUndefined();
  });

  it("finds the interval on every report the cluster wrote", () => {
    for (const report of vulnerabilityReports()) {
      expect(rescanIntervalOf(report), report.getName()).toBe(24 * HOUR);
    }
  });

  it.each([
    [undefined, DEFAULT_RESCAN_MS],
    ["0s", DEFAULT_RESCAN_MS],
    ["soon", DEFAULT_RESCAN_MS],
    ["72h0m0s", 72 * HOUR],
    ["12h0m0s", 12 * HOUR],
  ])("takes %j as an interval of %d ms", (ttl, expected) => {
    const [report] = reportsWithTtl(ttl);

    if (!report) throw new Error("no VulnerabilityReport in the fixtures");

    expect(rescanIntervalOf(report)).toBe(expected);
  });
});

describe("calling a verdict stale by its own report-ttl", () => {
  it("does not call a verdict stale that a 72h interval still covers", () => {
    const now = fixtureNow() + 30 * HOUR;
    const byDefault = staleAt(now, "24h0m0s");

    expect(byDefault.stale).toBe(byDefault.dated);
    expect(staleAt(now, "72h0m0s").stale).toBe(0);
  });

  it("calls a verdict stale that a 12h interval has outlived, though 24h would not", () => {
    const now = fixtureNow() + 13 * HOUR;
    const byDefault = staleAt(now, undefined);
    const short = staleAt(now, "12h0m0s");

    expect(short.stale).toBe(short.dated);
    expect(byDefault.stale).toBeLessThan(short.stale);
  });

  it("falls back to the operator's default for a report with no usable interval", () => {
    const now = fixtureNow() + 13 * HOUR;

    expect(staleAt(now, "0s").stale).toBe(staleAt(now, "24h0m0s").stale);
    expect(staleAt(now, undefined).stale).toBe(staleAt(now, "24h0m0s").stale);
  });
});

describe("judging a workload with one report per container", () => {
  // Dex has two containers, each with its own report.
  const DEX = "replicaset-argocd-dex-server-6f84fd5569";
  const dexOnly = (ttl: { copyutil: string; dex: string }) => (name: string) =>
    name === `${DEX}-copyutil` ? ttl.copyutil : name === `${DEX}-dex` ? ttl.dex : "8760h";

  it("calls the workload stale when either container's report outlives its own interval", () => {
    const scannedAt = Date.parse(reportNamed(`${DEX}-dex`).report?.updateTimestamp ?? "");
    const now = scannedAt + 13 * HOUR;

    expect(staleAt(now, undefined, dexOnly({ copyutil: "72h", dex: "72h" })).stale).toBe(0);
    expect(staleAt(now, undefined, dexOnly({ copyutil: "12h", dex: "72h" })).stale).toBe(1);
    expect(staleAt(now, undefined, dexOnly({ copyutil: "72h", dex: "12h" })).stale).toBe(1);
  });
});
