import { describe, expect, it } from "vitest";
import { countOf } from "../../src/renderer/api/shared/severity";
import { subjectKey } from "../../src/renderer/api/shared/subjects";
import { fixPublished, hasFix } from "../../src/renderer/api/vulnerabilities/findings";
import { getWorkloadReport } from "../../src/renderer/api/workloads/workload-report";
import {
  getWorkloadRows,
  mostExposed,
  sortWorkloads,
} from "../../src/renderer/api/workloads/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  pods,
  replicaSets,
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

const labelled = (name: string, report?: unknown) => ({
  getLabels: () => [
    "trivy-operator.resource.namespace=argocd",
    "trivy-operator.resource.kind=ReplicaSet",
    `trivy-operator.resource.name=${name}`,
  ],
  getOwnerRefs: () => [],
  report: report as never,
});

describe("listing every workload, judged or not", () => {
  it("lists more workloads than there are reports", () => {
    const rows = getWorkloadRows(clusterInput());

    expect(rows.length).toBeGreaterThan(vulnerabilityReports().length);
    expect(rows.some((row) => row.state !== "scanned")).toBe(true);
  });

  it("gives a scanned workload its findings, and an unjudged one none", () => {
    const rows = getWorkloadRows(clusterInput());
    const scanned = rows.filter((row) => row.state === "scanned");
    const unjudged = rows.filter((row) => row.state !== "scanned");

    expect(scanned.some((row) => countOf(row.summary, "CRITICAL") > 0)).toBe(true);
    expect(unjudged.every((row) => row.summary.criticalCount === undefined)).toBe(true);
  });

  it("carries the config check count alongside the vulnerabilities", () => {
    const rows = getWorkloadRows(clusterInput());

    expect(rows.some((row) => row.failedCheckCount > 0)).toBe(true);
  });

  it("adds up several containers of one workload into one row", () => {
    const rows = getWorkloadRows({
      ...EMPTY,
      vulnerabilityReports: [
        labelled("web", { summary: { criticalCount: 2 }, vulnerabilities: [] }),
        labelled("web", { summary: { criticalCount: 3 }, vulnerabilities: [] }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(countOf(rows[0]?.summary, "CRITICAL")).toBe(5);
  });

  it("counts a fix once per finding, as the workload's drawer does", () => {
    const row = getWorkloadRows(clusterInput()).find(
      (each) => each.subject.name === "argocd-dex-server-6f84fd5569",
    );

    if (!row) throw new Error("the fixtures have no dex row");

    const report = getWorkloadReport(row.subject, {
      vulnerability: vulnerabilityReports(),
      configAudit: [],
      exposedSecret: [],
    });
    const repeated = vulnerabilityReports()
      .filter((each) => each.getName().startsWith("replicaset-argocd-dex-server-6f84fd5569-"))
      .flatMap((each) => each.report?.vulnerabilities ?? [])
      .filter(hasFix).length;

    expect(row.fixableCount).toBe(fixPublished(report.vulnerabilities).fixable);
    expect(row.fixableCount).toBeLessThan(repeated);
    expect(row.criticalFixable + row.criticalUnfixable).toBe(
      report.vulnerabilities.filter((each) => each.severity === "CRITICAL").length,
    );
  });

  it("keeps the newest scan time when a workload has several reports", () => {
    const rows = getWorkloadRows({
      ...EMPTY,
      vulnerabilityReports: [
        labelled("web", { updateTimestamp: "2026-09-26T10:00:00Z" }),
        labelled("web", { updateTimestamp: "2026-09-26T12:00:00Z" }),
      ],
    });

    expect(rows[0]?.scannedAt).toBe("2026-09-26T12:00:00Z");
  });
});

describe("judging a ReplicaSet by the ReplicaSet itself", () => {
  const rowNamed = (rows: ReturnType<typeof getWorkloadRows>, name: string) =>
    rows.find((row) => row.subject.namespace === "demo" && row.subject.name === name);
  const withReplicaSets = (list = replicaSets()) =>
    getWorkloadRows({ ...clusterInput(), pods: pods(), replicaSets: list });

  it("keeps web's old ReplicaSet unjudged once it wants a pod again, and scaled away at zero", () => {
    const wanting = replicaSets().map((each) =>
      each.getName() === "web-794cc4c7f4" ? { ...each, spec: { replicas: 1 } } : each,
    );

    expect(rowNamed(withReplicaSets(), "web-794cc4c7f4")?.state).toBe("inactive");
    expect(rowNamed(withReplicaSets(wanting), "web-794cc4c7f4")?.state).toBe("read-but-no-verdict");
  });

  it("names a row's Deployment from its ReplicaSet's owner, and none for another controller", () => {
    const rollout = replicaSets().map((each) =>
      each.getName() === "web-5774f6f6c7"
        ? { ...each, getOwnerRefs: () => [{ kind: "Rollout", name: "web" }] }
        : each,
    );

    expect(rowNamed(withReplicaSets(), "web-5774f6f6c7")?.deployment).toBe("web");
    expect(rowNamed(withReplicaSets(rollout), "web-5774f6f6c7")?.deployment).toBeUndefined();
  });
});

describe("listing when nothing reported at all", () => {
  it("returns no rows rather than inventing them", () => {
    expect(getWorkloadRows(EMPTY)).toEqual([]);
    expect(sortWorkloads([])).toEqual([]);
  });

  it("skips a report of any kind that names no subject", () => {
    const anonymous = { getLabels: () => [], getOwnerRefs: () => [], report: {} as never };

    const rows = getWorkloadRows({
      vulnerabilityReports: [anonymous],
      sbomReports: [anonymous],
      configAuditReports: [anonymous],
      exposedSecretReports: [anonymous],
    });

    expect(rows).toEqual([]);
  });

  it("counts secrets and failed checks for a workload with no vulnerability report", () => {
    const rows = getWorkloadRows({
      ...EMPTY,
      configAuditReports: [labelled("web", { checks: [{ success: false }, { success: true }] })],
      exposedSecretReports: [labelled("web", { secrets: [{ ruleID: "one" }] })],
    });

    expect(rows[0]?.failedCheckCount).toBe(1);
    expect(rows[0]?.secretCount).toBe(1);
    expect(rows[0]?.state).toBe("never-looked");
  });

  it("reads a config or secret report whose body never arrived as nothing found", () => {
    const rows = getWorkloadRows({
      ...EMPTY,
      configAuditReports: [labelled("web", undefined)],
      exposedSecretReports: [labelled("web", undefined)],
    });

    expect(rows[0]?.failedCheckCount).toBe(0);
    expect(rows[0]?.secretCount).toBe(0);
  });

  it("gives a workload with a report but no body an empty summary", () => {
    const rows = getWorkloadRows({ ...EMPTY, vulnerabilityReports: [labelled("web", undefined)] });

    expect(rows[0]?.summary).toEqual({});
    expect(rows[0]?.fixableCount).toBe(0);
  });
});

describe("ordering the list", () => {
  it("puts what was never looked at above what was judged", () => {
    const rows = sortWorkloads(getWorkloadRows(clusterInput()));
    const states = rows.map((row) => row.state);
    const rank = { "never-looked": 0, "read-but-no-verdict": 1, scanned: 2, inactive: 3 } as const;
    const ranks = states.map((state) => rank[state]);

    expect([...ranks].sort((first, second) => first - second)).toEqual(ranks);
  });

  it("orders scanned workloads by criticals, then highs", () => {
    const scanned = sortWorkloads(getWorkloadRows(clusterInput())).filter(
      (row) => row.state === "scanned",
    );
    const criticals = scanned.map((row) => countOf(row.summary, "CRITICAL"));

    expect([...criticals].sort((first, second) => second - first)).toEqual(criticals);
  });

  it("breaks a tie by name so the order does not wander between renders", () => {
    const rows = sortWorkloads(
      getWorkloadRows({
        ...EMPTY,
        configAuditReports: [labelled("beta"), labelled("alpha")],
      }),
    );

    expect(rows.map((row) => subjectKey(row.subject))).toEqual([
      "argocd/ReplicaSet/alpha",
      "argocd/ReplicaSet/beta",
    ]);
  });
});

describe("the most exposed workloads", () => {
  const rows = () => getWorkloadRows(clusterInput());
  const serious = (row: ReturnType<typeof rows>[number]) =>
    countOf(row.summary, "CRITICAL") + countOf(row.summary, "HIGH");

  it("lists only scanned workloads with something critical or high", () => {
    const exposed = mostExposed(rows(), 100);

    expect(exposed.length).toBeGreaterThan(0);
    for (const row of exposed) {
      expect(row.state).toBe("scanned");
      expect(serious(row)).toBeGreaterThan(0);
    }

    expect(exposed).toHaveLength(
      rows().filter((row) => row.state === "scanned" && serious(row) > 0).length,
    );
  });

  it("puts the most critical first, then the most high", () => {
    const exposed = mostExposed(rows(), 100);
    const order = exposed.map((row) => [
      countOf(row.summary, "CRITICAL"),
      countOf(row.summary, "HIGH"),
    ]);
    const sorted = [...order].sort(
      ([criticalA = 0, highA = 0], [criticalB = 0, highB = 0]) =>
        criticalB - criticalA || highB - highA,
    );

    expect(order).toEqual(sorted);
  });

  it("stops at the limit", () => {
    expect(mostExposed(rows(), 3)).toHaveLength(3);
  });

  it("lists nothing when nothing was scanned", () => {
    expect(mostExposed(getWorkloadRows(EMPTY), 5)).toEqual([]);
  });
});
