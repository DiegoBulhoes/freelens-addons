import { describe, expect, it } from "vitest";
import {
  coverageInputOf,
  describeOverview,
  getOverview,
  unjudgedWorkloads,
} from "../../src/renderer/api/overview/overview";
import { countOf } from "../../src/renderer/api/shared/severity";
import { subjectKey, subjectOf } from "../../src/renderer/api/shared/subjects";
import { identityOf } from "../../src/renderer/api/vulnerabilities/findings";
import {
  configAuditReports,
  exposedSecretReports,
  pods,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

function clusterInput() {
  return {
    vulnerabilityReports: vulnerabilityReports(),
    sbomReports: sbomReports(),
    configAuditReports: configAuditReports(),
    exposedSecretReports: exposedSecretReports(),
  };
}

const EMPTY = {
  vulnerabilityReports: [],
  sbomReports: [],
  configAuditReports: [],
  exposedSecretReports: [],
};

describe("summarising what the operator reported", () => {
  it("counts more workloads than it has verdicts for, which is this cluster's state", () => {
    const overview = getOverview(clusterInput());

    expect(overview.counts.total).toBeGreaterThan(overview.counts.scanned);
    expect(overview.counts.readButNoVerdict).toBeGreaterThan(0);
    expect(overview.counts.neverLooked).toBeGreaterThan(0);
  });

  it("splits criticals into what a version bump would fix and what it would not", () => {
    const overview = getOverview(clusterInput());
    const summaryCriticals = countOf(overview.vulnerabilitySummary, "CRITICAL");
    const distinctCriticals = new Set(
      vulnerabilityReports().flatMap((report) => {
        const subject = subjectOf(report);

        if (!subject) return [];

        return (report.report?.vulnerabilities ?? [])
          .filter((vulnerability) => vulnerability.severity === "CRITICAL")
          .map((vulnerability) => `${subjectKey(subject)}\u0000${identityOf(vulnerability)}`);
      }),
    ).size;

    expect(overview.criticalFixable).toBeGreaterThan(0);
    expect(overview.criticalUnfixable).toBeGreaterThan(0);
    // Once per workload, where the summaries count each finding the operator repeats.
    expect(overview.criticalFixable + overview.criticalUnfixable).toBe(distinctCriticals);
    expect(summaryCriticals).toBeGreaterThanOrEqual(distinctCriticals);
  });

  it("does not count criticals twice when reporting highs", () => {
    const overview = getOverview(clusterInput());

    // highFixable excludes CRITICAL.
    expect(overview.highFixable).toBeGreaterThan(0);
    expect(overview.highFixable).not.toBe(overview.criticalFixable + overview.highFixable);
  });

  it("draws known workloads from every report kind, not just one", () => {
    const input = clusterInput();
    const fromAll = coverageInputOf(input).known.length;
    const fromAuditsAlone = coverageInputOf({ ...input, sbomReports: [], exposedSecretReports: [] })
      .known.length;

    expect(fromAll).toBeGreaterThan(fromAuditsAlone);
  });

  it("lists the unjudged worst-state first, and never a scanned one", () => {
    const overview = getOverview(clusterInput());
    const unjudged = unjudgedWorkloads(overview.coverage);

    const pairs = unjudged.map((entry) => [entry.state, entry.subject.name]);
    const states = pairs.map(([state]) => state);
    const lastNeverLooked = states.lastIndexOf("never-looked");

    // The seed's unscannable is never looked at, and web's old ReplicaSet has only an SBOM.
    expect(pairs).toContainEqual(["never-looked", "unscannable-7d45447486"]);
    expect(pairs).toContainEqual(["read-but-no-verdict", "web-794cc4c7f4"]);
    expect(states.indexOf("read-but-no-verdict")).toBeGreaterThan(lastNeverLooked);
    expect(new Set(states)).toEqual(new Set(["never-looked", "read-but-no-verdict"]));
  });
});

describe("summarising a cluster with no operator in it", () => {
  it("reports nothing rather than a clean bill of health", () => {
    const overview = getOverview(EMPTY);

    expect(overview.counts.total).toBe(0);
    expect(countOf(overview.vulnerabilitySummary, "CRITICAL")).toBe(0);
    expect(overview.criticalFixable).toBe(0);
    expect(unjudgedWorkloads(overview.coverage)).toEqual([]);
  });

  it("survives reports whose body never arrived", () => {
    const bodyless = vulnerabilityReports().map((report) => {
      report.report = undefined;

      return report;
    });

    const overview = getOverview({ ...EMPTY, vulnerabilityReports: bodyless });

    expect(overview.criticalFixable).toBe(0);
    expect(overview.vulnerabilitySummary).toEqual({});
    expect(overview.counts.total).toBeGreaterThan(0);
  });

  it("counts no exposed secrets when every list is empty, as this cluster's are", () => {
    expect(getOverview(clusterInput()).exposedSecrets).toBe(0);
  });

  it("counts on its card only the exposed secrets that are critical or high", () => {
    const [first, second, ...rest] = exposedSecretReports();

    if (!first?.report || !second?.report) throw new Error("the secret fixtures are gone");

    first.report.summary = { criticalCount: 1, highCount: 2, mediumCount: 3, lowCount: 4 };
    second.report.summary = { highCount: 5, lowCount: 6 };

    const overview = getOverview({
      ...clusterInput(),
      exposedSecretReports: [first, second, ...rest],
    });

    expect(overview.exposedSecrets).toBe(1 + 2 + 5);
  });
});

describe("summarising input that should not exist", () => {
  it("ignores a report carrying no subject labels at all", () => {
    const anonymous = {
      getLabels: () => [],
      getOwnerRefs: () => [],
      report: { summary: { criticalCount: 99 } },
    };

    const overview = getOverview({ ...EMPTY, vulnerabilityReports: [anonymous] });

    // Joins to no workload, so it does not inflate the coverage total.
    expect(countOf(overview.vulnerabilitySummary, "CRITICAL")).toBe(99);
    expect(overview.counts.total).toBe(0);
  });

  it("does not count a workload twice when several kinds report on it", () => {
    const report = {
      getLabels: () => [
        "trivy-operator.resource.namespace=argocd",
        "trivy-operator.resource.kind=ReplicaSet",
        "trivy-operator.resource.name=web",
      ],
      getOwnerRefs: () => [],
      report: {},
    };

    const overview = getOverview({
      vulnerabilityReports: [report],
      sbomReports: [report],
      configAuditReports: [report],
      exposedSecretReports: [report],
    });

    expect(overview.counts.total).toBe(1);
    expect(overview.counts.scanned).toBe(1);
  });

  it("leaves a Service out of the coverage count, having no image to scan", () => {
    const service = {
      getLabels: () => [
        "trivy-operator.resource.namespace=argocd",
        "trivy-operator.resource.kind=Service",
        "trivy-operator.resource.name=web",
      ],
      getOwnerRefs: () => [],
      report: { summary: { highCount: 3 } },
    };

    const overview = getOverview({ ...EMPTY, configAuditReports: [service] });

    expect(overview.counts.total).toBe(0);
    expect(countOf(overview.configAuditSummary, "HIGH")).toBe(3);
    expect(overview.configIssues).toBe(0);
  });
});

describe("the overview's head", () => {
  it("counts criticals against the workloads scanned, and warns while some wait", () => {
    const overview = getOverview(clusterInput());
    const head = describeOverview(overview);
    const criticals = countOf(overview.vulnerabilitySummary, "CRITICAL");

    expect(head.headline).toBe(
      `${criticals} critical findings in ${overview.counts.scanned} scanned workloads`,
    );
    expect(head.alarm).toBe(true);
    expect(head.subline).toMatch(/minimum/);
  });

  it("says an empty scope is empty, not clean", () => {
    const head = describeOverview(getOverview(EMPTY));

    expect(head.headline).toBe("No workload in the selected namespaces has a Trivy report");
    expect(head.alarm).toBe(false);
  });

  it("says every workload has a verdict, in the singular for one", () => {
    const [report] = vulnerabilityReports().filter(
      (each) => countOf(each.report?.summary, "CRITICAL") === 1,
    );

    expect(report).toBeDefined();

    const head = describeOverview(
      getOverview({ ...EMPTY, vulnerabilityReports: [report as NonNullable<typeof report>] }),
    );

    expect(head.headline).toBe("1 critical finding in 1 scanned workload");
    expect(head.subline).toBe("Every workload the operator knows about has a verdict.");
    expect(head.alarm).toBe(false);
  });
});

describe("leaving scaled-away ReplicaSets out of what waits on a verdict", () => {
  it("lists the old ReplicaSet of a rollout as waiting only when the pods are unknown", () => {
    const names = (input: Parameters<typeof getOverview>[0]) =>
      unjudgedWorkloads(getOverview(input).coverage).map((entry) => entry.subject.name);

    expect(names(clusterInput())).toContain("web-794cc4c7f4");
    expect(names({ ...clusterInput(), pods: pods() })).not.toContain("web-794cc4c7f4");
    expect(names({ ...clusterInput(), pods: pods(), podsUnreadIn: new Set(["demo"]) })).toContain(
      "web-794cc4c7f4",
    );
  });

  it("counts them apart, so the head's minimum does not include them", () => {
    const overview = getOverview({ ...clusterInput(), pods: pods() });
    const { counts } = overview;

    expect(counts.inactive).toBeGreaterThan(0);
    expect(unjudgedWorkloads(overview.coverage)).toHaveLength(
      counts.readButNoVerdict + counts.neverLooked,
    );
  });
});
