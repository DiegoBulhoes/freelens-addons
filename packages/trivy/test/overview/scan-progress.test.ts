import { describe, expect, it } from "vitest";

import {
  describeProgress,
  getScanProgress,
  judgedOf,
  recordJudged,
  type ScanProgress,
} from "../../src/renderer/api/overview/scan-progress";
import { describeDuration } from "../../src/renderer/api/shared/time";
import { getWorkloadRows, type WorkloadRow } from "../../src/renderer/api/workloads/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  fixtureNow,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

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
    criticalFixable: 0,
    criticalUnfixable: 0,
    highFixable: 0,
    failedCheckCount: 0,
    secretCount: 0,
    configIssues: 0,
    exposedSecrets: 0,
    scannedAt: spec.agoMs === undefined ? undefined : new Date(NOW - spec.agoMs).toISOString(),
  }));
}

describe("telling a rescan in progress from a dead operator", () => {
  it("calls the cluster's own half-scanned state working, not stalled", () => {
    const progress = getScanProgress(clusterRows(), NOW);

    // Fixtures were taken mid-rescan.
    expect(progress.state).toBe("working");
    expect(progress.judged).toBeLessThan(progress.total);
  });

  it("estimates the remaining time from how fast the judged count rose", () => {
    const progress = getScanProgress(
      rows([
        { judged: true, agoMs: 10 * MINUTE },
        { judged: true, agoMs: 20 * MINUTE },
        { judged: false },
        { judged: false },
      ]),
      NOW,
      [
        { at: NOW - HOUR, judged: 0 },
        { at: NOW - 10 * MINUTE, judged: 2 },
      ],
    );

    expect(progress.judgedGrowth).toBe(2);
    // Two an hour, two outstanding: about an hour.
    expect(progress.estimatedRemainingMs).toBe(HOUR);
    expect(describeProgress(progress)).toContain("2 in the last 1 hour");
    expect(describeProgress(progress)).toContain("about 1 hour");
  });

  it("calls it stalled when nothing has arrived and work remains", () => {
    const progress = getScanProgress(
      rows([{ judged: true, agoMs: 6 * HOUR }, { judged: false }]),
      NOW,
    );

    expect(progress.state).toBe("stalled");
    expect(describeProgress(progress)).toContain("The commands below look at the operator");
  });

  it("says a finished cluster is finished, with no estimate attached", () => {
    const progress = getScanProgress(rows([{ judged: true, agoMs: 2 * HOUR }]), NOW);

    expect(progress.state).toBe("complete");
    expect(progress.estimatedRemainingMs).toBeUndefined();
    expect(describeProgress(progress)).toBe("All 1 workload has a current verdict.");
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
    expect(describeProgress(progress)).toContain(
      "All 2 workloads have a verdict, but 1 is older than the operator's own rescan interval",
    );
  });

  it("says a lone stale workload in the singular", () => {
    const progress = getScanProgress(rows([{ judged: true, agoMs: 30 * HOUR }]), NOW);

    expect(progress.state).toBe("stale");
    expect(describeProgress(progress)).toMatch(/^All 1 workload has a verdict, but 1 is older/);
  });

  it("keeps the plural for several finished workloads", () => {
    const progress = getScanProgress(
      rows([
        { judged: true, agoMs: 2 * HOUR },
        { judged: true, agoMs: 1 * HOUR },
      ]),
      NOW,
    );

    expect(describeProgress(progress)).toBe("All 2 workloads have a current verdict.");
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

    expect(progress.judgedGrowth).toBeUndefined();
    expect(progress.estimatedRemainingMs).toBeUndefined();
    expect(describeProgress(progress)).not.toContain("Infinity");
  });
});

describe("judging progress from times that make no sense", () => {
  it("ignores a timestamp in the future rather than counting it as recent", () => {
    const progress = getScanProgress(rows([{ judged: true, agoMs: -HOUR }]), NOW);

    expect(progress.newestAgeMs).toBeUndefined();
    expect(progress.staleCount).toBe(0);
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
      judgedGrowth: 1,
      observedMs: HOUR,
      newestAgeMs: MINUTE,
      estimatedRemainingMs: HOUR,
      staleCount: 0,
    };

    expect(describeProgress(progress)).toContain("about 1 hour");
    expect(describeProgress(progress)).not.toContain("1 hours");
  });
});

describe("judging progress past a rollout", () => {
  it("does not call a scan stalled for a ReplicaSet the operator will never scan", () => {
    const [judged, gone] = rows([{ judged: true, agoMs: 6 * HOUR }, { judged: false }]);

    if (!judged || !gone) throw new Error("rows() built fewer rows than asked");

    const progress = getScanProgress([judged, { ...gone, state: "inactive" }], NOW);

    expect(progress.state).toBe("complete");
    expect(progress.total).toBe(1);
    expect(describeProgress(progress)).toBe("All 1 workload has a current verdict.");
  });
});

describe("telling new verdicts from routine rescans", () => {
  const cluster = clusterRows();
  const judged = judgedOf(cluster);
  const outstanding = cluster.filter((row) => row.state !== "scanned").length;

  it("calls it stalled when only rescans arrive and the judged count stays put", () => {
    // The fixtures' newest verdict is seconds old, which alone would read as working.
    const progress = getScanProgress(cluster, NOW, [{ at: NOW - 20 * MINUTE, judged }]);

    expect(outstanding).toBeGreaterThan(0);
    expect(progress.state).toBe("stalled");
    expect(progress.estimatedRemainingMs).toBeUndefined();
    expect(describeProgress(progress)).toContain("none was added in the last 20 minutes");
  });

  it("calls it working while the judged count rises, and estimates from that rise", () => {
    const progress = getScanProgress(cluster, NOW, [
      { at: NOW - 30 * MINUTE, judged: judged - 3 },
      { at: NOW - 5 * MINUTE, judged },
    ]);

    expect(progress.state).toBe("working");
    expect(progress.judgedGrowth).toBe(3);
    expect(progress.estimatedRemainingMs).toBe((outstanding / 3) * 30 * MINUTE);
    expect(describeProgress(progress)).toContain("3 in the last 30 minutes");
  });

  it("calls it stalled once the count has not risen for a while", () => {
    const progress = getScanProgress(cluster, NOW, [
      { at: NOW - 50 * MINUTE, judged: judged - 2 },
      { at: NOW - 40 * MINUTE, judged },
    ]);

    expect(progress.state).toBe("stalled");
    expect(describeProgress(progress)).toContain("none was added in the last 40 minutes");
  });

  it("does not take a report deleted for its TTL and written again for progress", () => {
    const progress = getScanProgress(cluster, NOW, [
      { at: NOW - 50 * MINUTE, judged: judged - 1 },
      { at: NOW - 40 * MINUTE, judged },
      { at: NOW - 30 * MINUTE, judged: judged - 1 },
      { at: NOW - 10 * MINUTE, judged },
    ]);

    expect(progress.state).toBe("stalled");
    expect(progress.idleMs).toBe(40 * MINUTE);
  });

  it("goes by the verdicts' age until it has watched long enough to tell", () => {
    const progress = getScanProgress(cluster, NOW, [{ at: NOW - 5 * MINUTE, judged }]);

    expect(progress.state).toBe("working");
    expect(progress.judgedGrowth).toBeUndefined();
    expect(progress.estimatedRemainingMs).toBeUndefined();
  });
});

describe("keeping the judged counts a page saw", () => {
  it("adds a sample only when the count changes", () => {
    const first = recordJudged([], 4, NOW - 10 * MINUTE);
    const same = recordJudged(first, 4, NOW - 5 * MINUTE);
    const more = recordJudged(same, 5, NOW);

    expect(same).toBe(first);
    expect(more).toEqual([
      { at: NOW - 10 * MINUTE, judged: 4 },
      { at: NOW, judged: 5 },
    ]);
  });

  it("keeps one sample older than the window as the baseline and drops the rest", () => {
    const history = [
      { at: NOW - 3 * HOUR, judged: 1 },
      { at: NOW - 2 * HOUR, judged: 2 },
      { at: NOW - 30 * MINUTE, judged: 3 },
    ];

    expect(recordJudged(history, 4, NOW)).toEqual([
      { at: NOW - 2 * HOUR, judged: 2 },
      { at: NOW - 30 * MINUTE, judged: 3 },
      { at: NOW, judged: 4 },
    ]);
  });

  it("keeps only the last sample when all of them are older than the window", () => {
    const history = [
      { at: NOW - 3 * HOUR, judged: 1 },
      { at: NOW - 2 * HOUR, judged: 2 },
    ];

    expect(recordJudged(history, 2, NOW)).toEqual([{ at: NOW - 2 * HOUR, judged: 2 }]);
  });
});
