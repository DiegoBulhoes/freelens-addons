import { describe, expect, it } from "vitest";

import {
  getRoleFindings,
  groupByCheck,
  type RbacReport,
  rolesAffected,
  summariseRbac,
} from "../src/renderer/api/rbac";
import { countOf } from "../src/renderer/api/severity";
import { allRbacReports, clusterRbacReports } from "./fixtures";

/**
 * A ClusterRole with no namespace is the case this had to be taught: the
 * operator writes the namespace label empty rather than leaving it out, and a
 * parser that treated empty as absent dropped every cluster-scoped role on the
 * floor — silently, which is the only way it could have gone unnoticed.
 */

const labelled = (
  name: string,
  namespace: string,
  kind: string,
  checks: unknown[],
): RbacReport => ({
  getLabels: () => [
    `trivy-operator.resource.namespace=${namespace}`,
    `trivy-operator.resource.kind=${kind}`,
    `trivy-operator.resource.name=${name}`,
  ],
  getOwnerRefs: () => [],
  report: { checks } as never,
});

describe("reading what roles are allowed to do", () => {
  it("finds failing checks across the cluster's own roles", () => {
    const findings = getRoleFindings(allRbacReports());

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding.check.success).toBe(false);
  });

  it("keeps cluster-scoped roles, whose namespace label is empty", () => {
    const findings = getRoleFindings(clusterRbacReports());

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.clusterScoped)).toBe(true);
    for (const finding of findings) expect(finding.subject.kind).toContain("Role");
  });

  it("drops the checks that passed", () => {
    const findings = getRoleFindings([
      labelled("r", "argocd", "Role", [
        { checkID: "A", success: true, severity: "CRITICAL" },
        { checkID: "B", success: false, severity: "LOW" },
      ]),
    ]);

    expect(findings.map((finding) => finding.check.checkID)).toEqual(["B"]);
  });

  it("puts the worst first, and a ClusterRole ahead of a Role of equal severity", () => {
    const findings = getRoleFindings([
      labelled("ns-role", "argocd", "Role", [{ checkID: "A", success: false, severity: "HIGH" }]),
      labelled("cluster-role", "", "ClusterRole", [
        { checkID: "A", success: false, severity: "HIGH" },
      ]),
      labelled("worst", "argocd", "Role", [{ checkID: "B", success: false, severity: "CRITICAL" }]),
    ]);

    expect(findings.map((finding) => finding.subject.name)).toEqual([
      "worst",
      "cluster-role",
      "ns-role",
    ]);
  });

  it("counts distinct roles, not rows", () => {
    const findings = getRoleFindings([
      labelled("r", "argocd", "Role", [
        { checkID: "A", success: false },
        { checkID: "B", success: false },
      ]),
    ]);

    expect(findings).toHaveLength(2);
    expect(rolesAffected(findings)).toBe(1);
  });

  it("groups by check, because one misconfiguration lands on many roles", () => {
    const findings = getRoleFindings([
      labelled("a", "", "ClusterRole", [
        { checkID: "KSV041", title: "Manage secrets", success: false, severity: "CRITICAL" },
      ]),
      labelled("b", "", "ClusterRole", [
        { checkID: "KSV041", title: "Manage secrets", success: false, severity: "CRITICAL" },
      ]),
    ]);

    const groups = groupByCheck(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.findings).toHaveLength(2);
    expect(groups[0]?.title).toBe("Manage secrets");
  });

  it("groups the cluster's real findings into far fewer checks than rows", () => {
    const findings = getRoleFindings(allRbacReports());
    const groups = groupByCheck(findings);

    expect(groups.length).toBeLessThan(findings.length);
    expect(groups.length).toBeGreaterThan(0);
  });
});

describe("reading roles with nothing to report", () => {
  it("returns nothing for an empty set", () => {
    expect(getRoleFindings([])).toEqual([]);
    expect(groupByCheck([])).toEqual([]);
    expect(summariseRbac([])).toEqual({});
    expect(rolesAffected([])).toBe(0);
  });

  it("returns nothing for a report whose body never arrived", () => {
    const bodyless = { getLabels: () => [], getOwnerRefs: () => [] } as RbacReport;

    expect(getRoleFindings([bodyless])).toEqual([]);
  });

  it("ignores a report that names no subject", () => {
    const anonymous = {
      getLabels: () => [],
      getOwnerRefs: () => [],
      report: { checks: [{ checkID: "A", success: false }] } as never,
    };

    expect(getRoleFindings([anonymous])).toEqual([]);
  });

  it("keeps a check whose success field is missing rather than guessing it passed", () => {
    const findings = getRoleFindings([labelled("r", "argocd", "Role", [{ checkID: "A" }])]);

    // `success !== false` covers undefined: an unstated result is not a failure.
    expect(findings).toEqual([]);
  });
});

describe("summarising role findings", () => {
  it("counts by severity, with an unstated one as UNKNOWN", () => {
    const findings = getRoleFindings([
      labelled("r", "argocd", "Role", [
        { checkID: "A", success: false, severity: "CRITICAL" },
        { checkID: "B", success: false, severity: "CRITICAL" },
        { checkID: "C", success: false },
      ]),
    ]);

    const summary = summariseRbac(findings);

    expect(countOf(summary, "CRITICAL")).toBe(2);
    expect(countOf(summary, "UNKNOWN")).toBe(1);
  });

  it("finds criticals among the cluster's own roles", () => {
    const summary = summariseRbac(getRoleFindings(allRbacReports()));

    expect(countOf(summary, "CRITICAL")).toBeGreaterThan(0);
  });

  it("invents no severity field that no check carried", () => {
    const findings = getRoleFindings([
      labelled("r", "argocd", "Role", [{ checkID: "A", success: false, severity: "LOW" }]),
    ]);

    expect(summariseRbac(findings)).toEqual({ lowCount: 1 });
  });
});
