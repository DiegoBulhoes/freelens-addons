import { describe, expect, it } from "vitest";

import {
  describeDuration,
  describeProgress,
  getScanProgress,
  type ScanProgress,
} from "../src/renderer/api/scan-progress";
import { getWorkloadRows, type WorkloadRow } from "../src/renderer/api/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  fixtureNow,
  sbomReports,
  vulnerabilityReports,
} from "./fixtures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = fixtureNow();

function clusterRows(): WorkloadRow[] {
  return getWorkloadRows({
    vulnerabilityReports: vulnerabilityReports(),
    sbomReports: sbomReports(),
    configAuditReports: configAuditReports(),
    exposedSecretReports: exposedSecretReports(),
  });
}

function rows(specs: { judged: boolean; agoMs?: number }[]): WorkloadRow[] {
  return specs.map((spec, index) => ({
    subject: { namespace: "argocd", kind: "ReplicaSet", name: `web-${index}` },
    state: spec.judged ? "scanned" : "never-looked",
    summary: {},
    fixableCount: 0,
    failedCheckCount: 0,
    secretCount: 0,
    scannedAt: spec.agoMs === undefined ? undefined : new Date(NOW - spec.agoMs).toISOString(),
  }));
}

describe("telling a rescan in progress from a dead operator", () => {
  it("calls the cluster's own half-scanned state working, not stalled", () => {
    const progress = getScanProgress(clusterRows(), NOW);

    // Fixtures were taken mid-rescan.
    expect(progress.state).toBe("working");
    expect(progress.judged).toBeLessThan(progress.total);
    expect(progress.recentRate).toBeGreaterThan(0);
  });

  it("estimates the remaining time from the rate it observed", () => {
    const progress = getScanProgress(
      rows([
        { judged: true, agoMs: 10 * MINUTE },
        { judged: true, agoMs: 20 * MINUTE },
        { judged: false },
        { judged: false },
      ]),
      NOW,
    );

    expect(progress.recentRate).toBe(2);
    // Two an hour, two outstanding: about an hour.
    expect(progress.estimatedRemainingMs).toBe(HOUR);
    expect(describeProgress(progress)).toContain("about 1 hour");
  });

  it("calls it stalled when nothing has arrived and work remains", () => {
    const progress = getScanProgress(
      rows([{ judged: true, agoMs: 6 * HOUR }, { judged: false }]),
      NOW,
    );

    expect(progress.state).toBe("stalled");
    expect(describeProgress(progress)).toContain("Check the operator");
  });

  it("says a finished cluster is finished, with no estimate attached", () => {
    const progress = getScanProgress(rows([{ judged: true, agoMs: 2 * HOUR }]), NOW);

    expect(progress.state).toBe("complete");
    expect(progress.estimatedRemainingMs).toBeUndefined();
    expect(describeProgress(progress)).toBe("All 1 workloads have a current verdict.");
  });

  it("flags verdicts older than the operator's own rescan interval", () => {
    const progress = getScanProgress(
      rows([
        { judged: true, agoMs: 30 * HOUR },
        { judged: true, agoMs: 1 * HOUR },
      ]),
      NOW,
    );

    expect(progress.state).toBe("stale");
    expect(progress.staleCount).toBe(1);
    expect(describeProgress(progress)).toContain("older than the operator's own rescan interval");
  });
});

describe("judging progress with nothing to judge", () => {
  it("says nothing is known rather than that everything is done", () => {
    const progress = getScanProgress([], NOW);

    expect(progress.state).toBe("nothing-known");
    expect(describeProgress(progress)).toContain("has not claimed any workload");
  });

  it("calls it stalled when no workload was ever judged", () => {
    const progress = getScanProgress(rows([{ judged: false }, { judged: false }]), NOW);

    expect(progress.state).toBe("stalled");
    expect(progress.newestAgeMs).toBeUndefined();
    expect(describeProgress(progress)).toContain("no verdict has ever been reached");
  });

  it("offers no estimate when the rate is zero, rather than an infinity", () => {
    const progress = getScanProgress(
      rows([{ judged: true, agoMs: 5 * HOUR }, { judged: false }]),
      NOW,
    );

    expect(progress.recentRate).toBe(0);
    expect(progress.estimatedRemainingMs).toBeUndefined();
    expect(describeProgress(progress)).not.toContain("Infinity");
  });
});

describe("judging progress from times that make no sense", () => {
  it("ignores a timestamp in the future rather than counting it as recent", () => {
    const progress = getScanProgress(rows([{ judged: true, agoMs: -HOUR }]), NOW);

    expect(progress.newestAgeMs).toBeUndefined();
    expect(progress.recentRate).toBe(0);
  });

  it("ignores a timestamp that is not a date", () => {
    const broken = rows([{ judged: true, agoMs: HOUR }]);

    (broken[0] as WorkloadRow).scannedAt = "not a date";

    expect(getScanProgress(broken, NOW).newestAgeMs).toBeUndefined();
  });

  it("rounds a duration to the unit a person would say", () => {
    expect(describeDuration(30_000)).toBe("less than a minute");
    expect(describeDuration(MINUTE)).toBe("1 minute");
    expect(describeDuration(90 * MINUTE)).toBe("2 hours");
    expect(describeDuration(50 * HOUR)).toBe("2 days");
  });

  it("names a count of one without a plural", () => {
    const progress: ScanProgress = {
      state: "working",
      judged: 1,
      total: 2,
      recentRate: 1,
      newestAgeMs: MINUTE,
      estimatedRemainingMs: HOUR,
      staleCount: 0,
    };

    expect(describeProgress(progress)).toContain("about 1 hour");
    expect(describeProgress(progress)).not.toContain("1 hours");
  });
});
