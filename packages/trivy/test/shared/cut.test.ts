import { describe, expect, it } from "vitest";
import { getOverview, unjudgedWorkloads } from "../../src/renderer/api/overview/overview";
import { cutTo } from "../../src/renderer/api/shared/cut";
import { subjectOf } from "../../src/renderer/api/shared/subjects";
import { selectWorkloads } from "../../src/renderer/api/workloads/workload-filter";
import { getWorkloadReport } from "../../src/renderer/api/workloads/workload-report";
import { getWorkloadRows } from "../../src/renderer/api/workloads/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  reportNamed,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

function webReport() {
  const subject = subjectOf(reportNamed("replicaset-web-5774f6f6c7-web"));

  if (!subject) throw new Error("the web fixture lost its subject labels");

  return getWorkloadReport(subject, {
    vulnerability: vulnerabilityReports(),
    configAudit: configAuditReports(),
    exposedSecret: exposedSecretReports(),
  });
}

describe("cutting a long list, with a way to see the rest", () => {
  it("shows the first ones and counts what it left out", () => {
    const { vulnerabilities } = webReport();
    const cut = cutTo(vulnerabilities, 100);

    expect(vulnerabilities.length).toBeGreaterThan(100);
    expect(cut.shown).toEqual(vulnerabilities.slice(0, 100));
    expect(cut.hidden).toBe(vulnerabilities.length - 100);
  });

  it("shows every one once asked, leaving nothing hidden", () => {
    const { failedChecks } = webReport();
    const cut = cutTo(failedChecks, 6, true);

    expect(failedChecks.length).toBeGreaterThan(6);
    expect(cut.shown).toEqual(failedChecks);
    expect(cut.hidden).toBe(0);
  });

  it("hides nothing from a list within its limit, so no toggle shows", () => {
    const { upgrades } = webReport();

    expect(cutTo(upgrades, upgrades.length).hidden).toBe(0);
    expect(cutTo(upgrades, upgrades.length + 1).shown).toEqual(upgrades);
  });

  it("opens Workloads on exactly the workloads the overview could not list", () => {
    // Half the verdicts withheld, so the section overflows its eight rows.
    const input = {
      vulnerabilityReports: vulnerabilityReports().filter((_, index) => index % 2 === 0),
      sbomReports: sbomReports(),
      configAuditReports: configAuditReports(),
      exposedSecretReports: exposedSecretReports(),
    };
    const unjudged = unjudgedWorkloads(getOverview(input).coverage);
    const listed = selectWorkloads(getWorkloadRows(input), "unjudged");

    expect(unjudged.length).toBeGreaterThan(8);
    expect(listed.map((row) => row.subject).sort(byKey)).toEqual(
      unjudged.map((entry) => entry.subject).sort(byKey),
    );
  });
});

function byKey(first: { name: string; namespace: string }, second: typeof first) {
  return `${first.namespace}/${first.name}`.localeCompare(`${second.namespace}/${second.name}`);
}
