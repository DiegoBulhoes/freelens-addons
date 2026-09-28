import { describe, expect, it } from "vitest";
import { countOf } from "../src/renderer/api/severity";
import { subjectOf } from "../src/renderer/api/subjects";
import type { ReportSubject } from "../src/renderer/api/types";
import {
  getWorkloadReport,
  summariseAction,
  upgradesClearing,
  type WorkloadReports,
} from "../src/renderer/api/workload-report";
import {
  configAuditReports,
  exposedSecretReports,
  reportNamed,
  vulnerabilityReports,
} from "./fixtures";

/**
 * The page this feeds opens with what to do, not with how much is wrong: three
 * upgrades clearing nine criticals is work someone can start; 408 findings is
 * not. These hold that the counting behind that sentence is real.
 */

function clusterReports(): WorkloadReports {
  return {
    vulnerability: vulnerabilityReports(),
    configAudit: configAuditReports(),
    exposedSecret: exposedSecretReports(),
  };
}

/** A real workload, nginx on an old Debian, with findings at every severity. Used throughout. */
function web(): ReportSubject {
  const subject = subjectOf(reportNamed("replicaset-web-5774f6f6c7-web"));

  if (!subject) throw new Error("the web fixture lost its subject labels");

  return subject;
}

describe("gathering what Trivy knows about one workload", () => {
  it("finds the image, the OS and the findings of a real workload", () => {
    const report = getWorkloadReport(web(), clusterReports());

    expect(report.image).toBe("library/nginx:1.24.0");
    expect(report.operatingSystem).toBe("debian 11.9");
    expect(countOf(report.summary, "CRITICAL")).toBe(17);
    expect(report.hasVulnerabilityReport).toBe(true);
  });

  it("turns hundreds of findings into a few dozen upgrades", () => {
    const report = getWorkloadReport(web(), clusterReports());

    expect(report.vulnerabilities.length).toBeGreaterThan(400);
    expect(report.upgrades.length).toBeLessThan(50);
    // The headline: a handful of bumps answers every critical.
    expect(upgradesClearing(report, "CRITICAL")).toHaveLength(7);
  });

  it("puts the upgrade that clears the most first within a severity", () => {
    const critical = upgradesClearing(getWorkloadReport(web(), clusterReports()), "CRITICAL");

    const counts = critical.map((upgrade) => upgrade.vulnerabilityCount);

    expect([...counts].sort((first, second) => second - first)).toEqual(counts);
    expect(critical[0]?.vulnerabilityCount).toBe(22);
  });

  it("counts the work and what cannot be worked on, separately", () => {
    const action = summariseAction(getWorkloadReport(web(), clusterReports()), "HIGH");

    expect(action.upgradeCount).toBeGreaterThan(0);
    expect(action.clearedCount).toBeGreaterThan(0);
    expect(action.clearedCount + action.unfixableCount).toBe(17 + 91);
  });

  it("names the container, the registry and the digest of what it scanned", () => {
    const [container] = getWorkloadReport(web(), clusterReports()).containers;

    expect(container?.name).toBe("web");
    expect(container?.registry).toBe("index.docker.io");
    expect(container?.digest).toMatch(/^sha256:/);
    expect(container?.scanner).toContain("Trivy");
  });

  it("gives every container of a workload its own entry, not just the first", () => {
    const dex = subjectOf(reportNamed("replicaset-argocd-dex-server-6f84fd5569-dex"));

    if (!dex) throw new Error("the dex fixture lost its subject labels");

    const report = getWorkloadReport(dex, clusterReports());

    // Dex runs two containers, each with its own report and its own image.
    expect(report.containers).toHaveLength(2);
    for (const container of report.containers) expect(container.image).toBeDefined();
  });

  it("keeps failed config checks and drops the ones that passed", () => {
    const report = getWorkloadReport(web(), clusterReports());

    expect(report.hasConfigAuditReport).toBe(true);
    expect(report.failedChecks.every((check) => check.success === false)).toBe(true);
  });

  it("orders failed checks worst first", () => {
    const { failedChecks } = getWorkloadReport(web(), clusterReports());
    const ranks = failedChecks.map((check) =>
      ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(check.severity ?? ""),
    );

    expect([...ranks].sort((first, second) => first - second)).toEqual(ranks);
  });
});

describe("gathering for a workload nothing reported on", () => {
  const unknown: ReportSubject = { namespace: "nowhere", kind: "ReplicaSet", name: "ghost" };

  it("says it has no report rather than that it is clean", () => {
    const report = getWorkloadReport(unknown, clusterReports());

    expect(report.hasVulnerabilityReport).toBe(false);
    expect(report.hasConfigAuditReport).toBe(false);
    expect(report.summary).toEqual({});
    expect(report.upgrades).toEqual([]);
    expect(report.image).toBeUndefined();
  });

  it("proposes no action for a workload nobody judged", () => {
    expect(summariseAction(getWorkloadReport(unknown, clusterReports()))).toEqual({
      upgradeCount: 0,
      clearedCount: 0,
      unfixableCount: 0,
    });
  });

  it("does not borrow another workload's findings", () => {
    const report = getWorkloadReport(
      { ...web(), namespace: "a-different-namespace" },
      clusterReports(),
    );

    expect(report.vulnerabilities).toEqual([]);
  });
});

describe("gathering from reports shaped oddly", () => {
  const subject: ReportSubject = { namespace: "argocd", kind: "ReplicaSet", name: "web" };
  const labelled = (report: unknown) => ({
    getLabels: () => [
      "trivy-operator.resource.namespace=argocd",
      "trivy-operator.resource.kind=ReplicaSet",
      "trivy-operator.resource.name=web",
    ],
    getOwnerRefs: () => [],
    report: report as never,
  });

  it("adds up several containers of one workload rather than taking the first", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [
        labelled({
          summary: { criticalCount: 2 },
          vulnerabilities: [{ vulnerabilityID: "CVE-1", severity: "CRITICAL" }],
        }),
        labelled({
          summary: { criticalCount: 3 },
          vulnerabilities: [{ vulnerabilityID: "CVE-2", severity: "CRITICAL" }],
        }),
      ],
      configAudit: [],
      exposedSecret: [],
    });

    expect(countOf(report.summary, "CRITICAL")).toBe(5);
    expect(report.vulnerabilities).toHaveLength(2);
  });

  it("counts a finding the operator emitted twice as one", () => {
    // The operator writes one row per Go binary embedding a module, with no
    // target to tell them apart, so identical rows are one finding.
    const twice = { vulnerabilityID: "CVE-1", resource: "otel", installedVersion: "v1.43.0" };
    const report = getWorkloadReport(subject, {
      vulnerability: [labelled({ vulnerabilities: [twice, { ...twice }, { ...twice }] })],
      configAudit: [],
      exposedSecret: [],
    });

    expect(report.vulnerabilities).toHaveLength(1);
  });

  it("keeps two findings of one package that name different targets", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [
        labelled({
          vulnerabilities: [
            { vulnerabilityID: "CVE-1", resource: "libc", target: "usr/bin/one" },
            { vulnerabilityID: "CVE-1", resource: "libc", target: "usr/bin/two" },
          ],
        }),
      ],
      configAudit: [],
      exposedSecret: [],
    });

    expect(report.vulnerabilities).toHaveLength(2);
  });

  it("survives a report whose body never arrived", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [labelled(undefined)],
      configAudit: [labelled(undefined)],
      exposedSecret: [labelled(undefined)],
    });

    // The report exists, so it is not "never scanned" — it just says nothing.
    expect(report.hasVulnerabilityReport).toBe(true);
    expect(report.summary).toEqual({});
    expect(report.exposedSecretCount).toBe(0);
  });

  it("leaves a container unnamed rather than guessing when the label is absent", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [labelled({ artifact: { repository: "library/busybox" } })],
      configAudit: [],
      exposedSecret: [],
    });

    expect(report.containers[0]?.name).toBeUndefined();
    expect(report.containers[0]?.image).toBe("library/busybox");
  });

  it("names an image with no tag without inventing one", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [labelled({ artifact: { repository: "library/busybox" } })],
      configAudit: [],
      exposedSecret: [],
    });

    expect(report.image).toBe("library/busybox");
  });

  it("names the OS version even when the family is missing", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [labelled({ os: { name: "12.10" } })],
      configAudit: [],
      exposedSecret: [],
    });

    expect(report.operatingSystem).toBe("12.10");
  });

  it("leaves the OS out when the report names no version", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [labelled({ os: { family: "debian" } })],
      configAudit: [],
      exposedSecret: [],
    });

    expect(report.operatingSystem).toBeUndefined();
  });

  it("counts secrets across several reports of one workload", () => {
    const report = getWorkloadReport(subject, {
      vulnerability: [],
      configAudit: [],
      exposedSecret: [
        labelled({ secrets: [{ ruleID: "one" }, { ruleID: "two" }] }),
        labelled({ secrets: [{ ruleID: "three" }] }),
      ],
    });

    expect(report.exposedSecretCount).toBe(3);
  });
});
