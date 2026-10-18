import { describe, expect, it } from "vitest";
import { getOverview } from "../../src/renderer/api/overview/overview";
import type { ScanState } from "../../src/renderer/api/overview/scan-progress";
import {
  scanCommandsFor,
  subjectSelector,
  workloadCommandsFor,
} from "../../src/renderer/api/shared/commands";
import { subjectOf } from "../../src/renderer/api/shared/subjects";
import type { CoverageState } from "../../src/renderer/api/workloads/coverage";
import {
  allRbacReports,
  configAuditReports,
  exposedSecretReports,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

const pairsOf = (selector: string) => selector.split(",");

describe("the commands that look further at the operator", () => {
  it("offers them when the scan is stalled or stale, and only then", () => {
    const offered = (state: ScanState) => scanCommandsFor(state).length > 0;

    expect(offered("stalled")).toBe(true);
    expect(offered("stale")).toBe(true);
    expect(offered("working")).toBe(false);
    expect(offered("complete")).toBe(false);
    expect(offered("nothing-known")).toBe(false);
  });

  it("finds the operator and greps its errors without knowing its namespace", () => {
    const commands = scanCommandsFor("stalled").map((each) => each.command);
    const logs = commands.find((each) => each.startsWith("kubectl logs "));

    expect(commands).toContain(
      "kubectl get deployments -A -l app.kubernetes.io/name=trivy-operator",
    );
    expect(logs).toMatch(/^kubectl logs -n "\$\(kubectl get deployments -A -l [^)]+\)" /);
    expect(logs).toMatch(/\| grep -i error$/);
  });

  it("lists the scan Jobs by the label the operator writes on everything it creates", () => {
    const managed = "app.kubernetes.io/managed-by=trivy-operator";

    expect(scanCommandsFor("stale").map((each) => each.command)).toContain(
      `kubectl get jobs -A -l ${managed}`,
    );
    for (const report of vulnerabilityReports()) expect(report.getLabels()).toContain(managed);
  });

  it("selects a workload by the labels the operator wrote on its reports, name included", () => {
    for (const report of [...vulnerabilityReports(), ...configAuditReports(), ...sbomReports()]) {
      const subject = subjectOf(report);

      if (!subject) continue;

      const pairs = pairsOf(subjectSelector(subject));

      expect(pairs).toContain(`trivy-operator.resource.name=${subject.name}`);
      for (const pair of pairs) expect(report.getLabels()).toContain(pair);
    }
  });

  it("leaves out a name the operator hashed, such as one with a ':', to select anything", () => {
    const hashed = allRbacReports().filter((report) =>
      report.getLabels().some((label) => label.startsWith("trivy-operator.resource.name-hash=")),
    );

    expect(hashed.length).toBeGreaterThan(0);
    for (const report of hashed) {
      const subject = subjectOf(report);

      if (!subject) throw new Error("a hashed fixture lost its subject");

      const pairs = pairsOf(subjectSelector(subject));

      expect(pairs.some((pair) => pair.startsWith("trivy-operator.resource.name="))).toBe(false);
      for (const pair of pairs) expect(report.getLabels()).toContain(pair);
    }
  });

  it("offers them in a workload's drawer only while it has no verdict", () => {
    const overview = getOverview({
      vulnerabilityReports: vulnerabilityReports(),
      sbomReports: sbomReports(),
      configAuditReports: configAuditReports(),
      exposedSecretReports: exposedSecretReports(),
    });
    const states = new Set<CoverageState>(overview.coverage.map((entry) => entry.state));

    expect(states.has("scanned")).toBe(true);
    expect(states.has("read-but-no-verdict")).toBe(true);
    for (const entry of overview.coverage) {
      const commands = workloadCommandsFor(entry.subject, entry.state);

      if (entry.state === "scanned") {
        expect(commands).toEqual([]);
        continue;
      }

      expect(commands[0]?.command).toBe(`kubectl get jobs -A -l ${subjectSelector(entry.subject)}`);
      expect(commands[1]?.command).toContain(`-n ${entry.subject.namespace} `);
    }

    const [anyEntry] = overview.coverage;

    if (!anyEntry) throw new Error("the fixtures lost their workloads");

    expect(workloadCommandsFor(anyEntry.subject, "inactive")).toEqual([]);
    expect(workloadCommandsFor(anyEntry.subject, "never-looked")).toHaveLength(4);
  });

  it("only reads: every command gets, lists or greps", () => {
    const [first] = vulnerabilityReports();
    const subject = first && subjectOf(first);

    if (!subject) throw new Error("the fixture lost its subject");

    const commands = [
      ...scanCommandsFor("stalled"),
      ...workloadCommandsFor(subject, "read-but-no-verdict"),
    ].map((each) => each.command);

    for (const command of commands) expect(command).toMatch(/^kubectl (get|logs) /);
    expect(commands.join("\n")).not.toMatch(/\b(delete|patch|apply|edit|annotate|label)\b/);
  });
});
