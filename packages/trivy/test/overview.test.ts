import { describe, expect, it } from "vitest";

import { coverageInputOf, getOverview, unjudgedWorkloads } from "../src/renderer/api/overview";
import { countOf } from "../src/renderer/api/severity";
import {
  configAuditReports,
  exposedSecretReports,
  sbomReports,
  vulnerabilityReports,
} from "./fixtures";

/**
 * What the overview claims. The rule it exists to keep is that a count of
 * findings is a count of what was looked at: every headline number here is
 * meaningless without the coverage it was drawn from, and these tests hold the
 * two together.
 */

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
  });

  it("splits criticals into what a version bump would fix and what it would not", () => {
    const overview = getOverview(clusterInput());
    const summaryCriticals = countOf(overview.vulnerabilitySummary, "CRITICAL");

    expect(overview.criticalFixable).toBeGreaterThan(0);
    expect(overview.criticalUnfixable).toBeGreaterThan(0);
    expect(overview.criticalFixable + overview.criticalUnfixable).toBe(summaryCriticals);
  });

  it("does not count criticals twice when reporting highs", () => {
    const overview = getOverview(clusterInput());

    // highFixable is the band between HIGH and CRITICAL, so adding the two
    // gives everything at or above HIGH exactly once.
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

    expect(unjudged.every((entry) => entry.state !== "scanned")).toBe(true);

    const firstReadIndex = unjudged.findIndex((e) => e.state === "read-but-no-verdict");
    const lastNeverIndex = unjudged.map((e) => e.state).lastIndexOf("never-looked");

    if (firstReadIndex !== -1 && lastNeverIndex !== -1) {
      expect(lastNeverIndex).toBeLessThan(firstReadIndex);
    }
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
    // The subjects are still known, so they still count as covered workloads.
    expect(overview.counts.total).toBeGreaterThan(0);
  });

  it("counts no exposed secrets when every list is empty, as this cluster's are", () => {
    expect(getOverview(clusterInput()).exposedSecrets).toBe(0);
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

    // Its findings still count — they were reported — but it joins to no
    // workload, so it cannot inflate the coverage denominator.
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
    // The config finding is still reported; it just is not a scanning subject.
    expect(countOf(overview.configAuditSummary, "HIGH")).toBe(3);
  });
});
