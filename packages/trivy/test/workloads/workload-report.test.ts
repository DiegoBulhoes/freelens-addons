import { describe, expect, it } from "vitest";
import { countOf } from "../../src/renderer/api/shared/severity";
import { subjectOf } from "../../src/renderer/api/shared/subjects";
import type { ReportSubject } from "../../src/renderer/api/shared/types";
import { COVERAGE_STATUS } from "../../src/renderer/api/workloads/coverage";
import {
  describeBase,
  describeLowerUpgrades,
  getWorkloadReport,
  imageOf,
  isEndOfLife,
  osOf,
  scannerOf,
  summariseAction,
  ticketText,
  unfixableOf,
  upgradesClearing,
  type WorkloadReports,
  workloadVerdict,
} from "../../src/renderer/api/workloads/workload-report";
import { getWorkloadRows } from "../../src/renderer/api/workloads/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  reportNamed,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

function clusterReports(): WorkloadReports {
  return {
    vulnerability: vulnerabilityReports(),
    configAudit: configAuditReports(),
    exposedSecret: exposedSecretReports(),
  };
}

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

    expect(report.containers).toHaveLength(2);
    for (const container of report.containers) expect(container.image).toBeDefined();
  });

  it("keeps failed config checks and drops the ones that passed", () => {
    const report = getWorkloadReport(web(), clusterReports());

    expect(report.hasConfigAuditReport).toBe(true);
    expect(report.failedChecks.length).toBeGreaterThan(0);
    expect(report.failedChecks.every((check) => check.success === false)).toBe(true);
  });

  it("orders failed checks worst first", () => {
    const { failedChecks } = getWorkloadReport(web(), clusterReports());
    const ranks = failedChecks.map((check) =>
      ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(check.severity ?? ""),
    );

    expect(
      new Set(ranks).size,
      "the checks share one severity, so no order is shown",
    ).toBeGreaterThan(1);

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
    // Go binaries yield identical rows with no target.
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

    // The report exists, so it is not "never scanned".
    expect(report.hasVulnerabilityReport).toBe(true);
    expect(report.summary).toEqual({});
    expect(report.exposedSecrets.length).toBe(0);
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

    expect(report.exposedSecrets.length).toBe(3);
  });
});

describe("the state a workload's drawer opens on", () => {
  const rows = () =>
    getWorkloadRows({
      vulnerabilityReports: vulnerabilityReports(),
      sbomReports: sbomReports(),
      configAuditReports: configAuditReports(),
      exposedSecretReports: exposedSecretReports(),
    });

  it("leads with the upgrades that clear a workload's criticals, and what none clears", () => {
    const report = getWorkloadReport(web(), clusterReports());
    const action = summariseAction(report, "HIGH");
    const verdict = workloadVerdict("scanned", report);

    expect(verdict.tone).toBe("critical");
    expect(verdict.label).toMatch(
      new RegExp(
        `^${action.upgradeCount} upgrades clear ${action.clearedCount} of \\d+ critical and high findings$`,
      ),
    );
    expect(verdict.reason).toContain(`${action.unfixableCount} have no published fix`);
  });

  it("does not call an unjudged workload clean, whichever way it is unjudged", () => {
    const unjudged = rows().filter((row) => row.state !== "scanned");

    expect(new Set(unjudged.map((row) => row.state))).toEqual(
      new Set(["never-looked", "read-but-no-verdict"]),
    );

    for (const row of unjudged) {
      const verdict = workloadVerdict(row.state, getWorkloadReport(row.subject, clusterReports()));

      expect(verdict.tone).not.toBe("ok");
      expect(verdict.reason).toMatch(/does not mean it is clean/);
    }

    expect(workloadVerdict("never-looked", getWorkloadReport(web(), clusterReports())).tone).toBe(
      "critical",
    );
    expect(
      workloadVerdict("read-but-no-verdict", getWorkloadReport(web(), clusterReports())).tone,
    ).toBe("warning");
  });

  it("names an unjudged workload in its banner with the words of its Coverage cell", () => {
    const report = getWorkloadReport(web(), clusterReports());

    for (const state of ["never-looked", "read-but-no-verdict", "inactive"] as const) {
      const { label, tone } = workloadVerdict(state, report);

      expect({ label, tone }).toEqual(COVERAGE_STATUS[state]);
    }
  });

  const scannedWith = (vulnerabilities: unknown[], summary: Record<string, number>) =>
    getWorkloadReport(
      { namespace: "argocd", kind: "ReplicaSet", name: "web" },
      {
        vulnerability: [
          {
            getLabels: () => [
              "trivy-operator.resource.namespace=argocd",
              "trivy-operator.resource.kind=ReplicaSet",
              "trivy-operator.resource.name=web",
            ],
            getOwnerRefs: () => [],
            report: { summary, vulnerabilities } as never,
          },
        ],
        configAudit: [],
        exposedSecret: [],
      },
    );

  it("clears exactly as many findings as it says there are, on every scanned workload", () => {
    const scanned = rows().filter((row) => row.state === "scanned");
    const dex = scanned.find((row) => row.subject.name.startsWith("argocd-dex-server-"));

    let counted = 0;
    // Built once: the reports are large and every row reads them.
    const reports = clusterReports();

    // Dex's two containers repeat findings: its summary says 86 where 75 are distinct.
    if (!dex) throw new Error("the dex fixture is gone");
    for (const row of scanned) {
      const report = getWorkloadReport(row.subject, reports);
      const action = summariseAction(report, "HIGH");
      const label = workloadVerdict("scanned", report).label;
      const total = /clears? \d+ of (\d+) critical/.exec(label)?.[1];

      if (total === undefined) continue;
      counted += 1;
      expect(action.clearedCount + action.unfixableCount).toBe(Number(total));
    }
    expect(counted, "no verdict counted what it clears").toBeGreaterThan(1);

    const dexReport = getWorkloadReport(dex.subject, clusterReports());
    const dexAction = summariseAction(dexReport, "HIGH");

    expect(workloadVerdict("scanned", dexReport).label).toContain(
      `${dexAction.clearedCount} of ${dexAction.clearedCount + dexAction.unfixableCount} critical`,
    );
  });

  it("does not call a report that counts findings without listing them clean", () => {
    const verdict = workloadVerdict("scanned", scannedWith([], { criticalCount: 2, highCount: 1 }));

    expect(verdict.tone).toBe("critical");
    expect(verdict.label).toBe("3 critical and high findings");
    expect(workloadVerdict("scanned", scannedWith([], { highCount: 1 })).tone).toBe("warning");
  });

  it("explains a scaled-away ReplicaSet rather than calling it unjudged or clean", () => {
    const verdict = workloadVerdict("inactive", getWorkloadReport(web(), clusterReports()));

    expect(verdict.tone).toBe("info");
    expect(verdict.label).toBe("Scaled away");
  });

  it("calls a scanned workload with nothing critical or high fine", () => {
    expect(workloadVerdict("scanned", scannedWith([], { lowCount: 2 }))).toMatchObject({
      tone: "ok",
      label: "Scanned",
    });
  });

  it("warns, not alarms, on highs alone, and says when nothing has a fix", () => {
    const verdict = workloadVerdict(
      "scanned",
      scannedWith([{ vulnerabilityID: "CVE-1", severity: "HIGH", fixedVersion: "" }], {
        highCount: 1,
      }),
    );

    expect(verdict.tone).toBe("warning");
    expect(verdict.label).toBe("No upgrade published for anything critical or high");
    expect(verdict.reason).toBe("1 have no published fix, so no upgrade will clear them.");
  });

  it("says so when every critical and high finding has a fix", () => {
    const verdict = workloadVerdict(
      "scanned",
      scannedWith(
        [{ vulnerabilityID: "CVE-1", resource: "zlib", severity: "HIGH", fixedVersion: "2" }],
        { highCount: 1 },
      ),
    );

    expect(verdict.label).toBe("1 upgrade clears 1 of 1 critical and high findings");
    expect(verdict.reason).toBe("Every critical and high finding here has a published fix.");
  });
});

describe("what a workload's drawer lists and copies", () => {
  it("lists as unfixable only critical and high findings with no fix", () => {
    const report = getWorkloadReport(web(), clusterReports());
    const unfixable = unfixableOf(report, "HIGH");

    expect(unfixable.length).toBeGreaterThan(0);
    expect(unfixable).toHaveLength(summariseAction(report, "HIGH").unfixableCount);
    for (const each of unfixable) {
      expect(each.fixedVersion ?? "").toBe("");
      expect(["CRITICAL", "HIGH"]).toContain(each.severity);
    }
  });

  it("copies one line naming the workload and its image, then one per upgrade it counts", () => {
    const report = getWorkloadReport(web(), clusterReports());
    const lines = ticketText(report).split("\n");

    expect(lines[0]).toBe(`${web().name} (${web().namespace}) — library/nginx:1.24.0`);
    expect(lines).toHaveLength(upgradesClearing(report, "HIGH").length + 1);
    expect(lines[1]).toMatch(/^\S+ \S+ -> \S+ \(clears \d+\)$/);
  });

  it("sizes the ticket as the verdict does, leaving out upgrades for lesser findings", () => {
    const report = getWorkloadReport(web(), clusterReports());
    const upgradeLines = ticketText(report).split("\n").length - 1;

    expect(upgradeLines).toBe(summariseAction(report, "HIGH").upgradeCount);
    expect(upgradeLines).toBeLessThan(report.upgrades.length);
  });

  it("names how many upgrades clear only lesser findings", () => {
    const report = getWorkloadReport(web(), clusterReports());
    const lower = report.upgrades.length - upgradesClearing(report, "HIGH").length;

    expect(describeLowerUpgrades(report)).toBe(
      `${lower} more upgrades clear only findings below high, left out here.`,
    );
  });

  it("adds no note when every upgrade clears something critical or high", () => {
    const report = getWorkloadReport(web(), clusterReports());
    const onlyClearing = { ...report, upgrades: upgradesClearing(report, "HIGH") };

    expect(describeLowerUpgrades(onlyClearing)).toBeUndefined();
  });

  it("says no image was reported rather than leaving a blank", () => {
    const report = getWorkloadReport(
      { namespace: "nowhere", kind: "Pod", name: "x" },
      clusterReports(),
    );

    expect(ticketText(report)).toBe("x (nowhere) — no image reported");
  });
});

describe("describing one report for the host's drawer", () => {
  it("names the image, the base and the scanner of a real report", () => {
    const body = reportNamed("replicaset-web-5774f6f6c7-web").report;

    expect(imageOf(body)).toBe("library/nginx:1.24.0");
    expect(osOf(body)).toBe("debian 11.9");
    expect(scannerOf(body)).toMatch(/^Trivy \d+\.\d+/);
  });

  it("names no scanner when the report gives no version", () => {
    expect(scannerOf(undefined)).toBeUndefined();
    expect(scannerOf({ scanner: { name: "Trivy" } })).toBeUndefined();
    expect(scannerOf({ scanner: { version: "0.1" } })).toBe("Trivy 0.1");
  });
});

describe("naming the secrets a workload exposes", () => {
  function withSecrets() {
    const reports = exposedSecretReports();
    const found = reports.find((report) => report.getName() === "replicaset-web-5774f6f6c7-web");

    if (!found?.report) throw new Error("the web secret report is gone");

    // The operator's own shape, `match` included, on the exported report of web.
    found.report.secrets = [
      {
        ruleID: "aws-access-key-id",
        title: "AWS Access Key ID",
        severity: "LOW",
        target: "/etc/app/config.env",
        category: "AWS",
        match: "AWS_ACCESS_KEY_ID=AKIA****************",
      },
      {
        ruleID: "private-key",
        title: "Asymmetric Private Key",
        severity: "HIGH",
        target: "/etc/ssl/private/server.key",
        category: "AsymmetricPrivateKey",
        match: "-----BEGIN RSA PRIVATE KEY-----****",
      },
    ] as never;

    return getWorkloadReport(web(), { ...clusterReports(), exposedSecret: reports });
  }

  it("lists each one's severity, title, file and rule, worst first", () => {
    const listed = withSecrets().exposedSecrets.map(({ key: _key, ...rest }) => rest);

    expect(listed).toEqual([
      {
        severity: "HIGH",
        title: "Asymmetric Private Key",
        target: "/etc/ssl/private/server.key",
        ruleID: "private-key",
      },
      {
        severity: "LOW",
        title: "AWS Access Key ID",
        target: "/etc/app/config.env",
        ruleID: "aws-access-key-id",
      },
    ]);
  });

  it("keys two matches of one rule in one file apart", () => {
    const reports = exposedSecretReports();
    const found = reports.find((report) => report.getName() === "replicaset-web-5774f6f6c7-web");

    if (!found?.report) throw new Error("the web secret report is gone");

    found.report.secrets = [
      { ruleID: "private-key", target: "/etc/ssl/a.key", severity: "HIGH" },
      { ruleID: "private-key", target: "/etc/ssl/a.key", severity: "HIGH" },
    ];

    const report = getWorkloadReport(web(), { ...clusterReports(), exposedSecret: reports });
    const keys = report.exposedSecrets.map((secret) => secret.key);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("never carries the matched text", () => {
    const report = withSecrets();

    expect(JSON.stringify(report)).not.toContain("AKIA");
    expect(JSON.stringify(report)).not.toContain("BEGIN RSA");
    expect(report.exposedSecrets.length).toBe(2);
  });

  it("lists none for a workload whose report found none, as this cluster's did", () => {
    expect(getWorkloadReport(web(), clusterReports()).exposedSecrets).toEqual([]);
  });
});

describe("an image whose base is past its end of life", () => {
  const endOfLife = () => vulnerabilityReports().filter((report) => report.report?.os?.eosl);

  it("is read from the reports that say so, and only from them", () => {
    expect(endOfLife()).toHaveLength(7);
    for (const report of vulnerabilityReports()) {
      expect(isEndOfLife(report.report)).toBe(report.report?.os?.eosl === true);
    }
  });

  it("is named next to its OS, saying the findings are incomplete", () => {
    const [guestbook] = endOfLife();

    expect(describeBase(guestbook?.report)).toBe(
      `${osOf(guestbook?.report)}, end of life: findings are incomplete`,
    );
    expect(describeBase(reportNamed("replicaset-argocd-dex-server-6f84fd5569-dex").report)).toBe(
      osOf(reportNamed("replicaset-argocd-dex-server-6f84fd5569-dex").report),
    );
    expect(describeBase(undefined)).toBeUndefined();
  });

  it("marks the container and says so in the verdict", () => {
    const report = getWorkloadReport(web(), clusterReports());

    expect(report.containers.map((container) => container.endOfLife)).toEqual([true]);
    expect(workloadVerdict("scanned", report).reason).toMatch(/end of life/);
  });

  it("is not called clean when nothing was found in it", () => {
    const reports = vulnerabilityReports();
    const found = reports.find((report) => report.getName() === "replicaset-web-5774f6f6c7-web");

    if (!found?.report) throw new Error("the web report is gone");

    found.report.vulnerabilities = [];
    found.report.summary = {};

    const verdict = workloadVerdict(
      "scanned",
      getWorkloadReport(web(), { ...clusterReports(), vulnerability: reports }),
    );

    expect(verdict.label).toBe("Scanned");
    expect(verdict.tone).toBe("warning");
  });

  it("leaves the verdict of a supported base as it was", () => {
    const dex = subjectOf(reportNamed("replicaset-argocd-dex-server-6f84fd5569-dex"));

    if (!dex) throw new Error("the dex fixture lost its subject labels");

    const verdict = workloadVerdict("scanned", getWorkloadReport(dex, clusterReports()));

    expect(verdict.reason).not.toMatch(/end of life/);
  });
});
