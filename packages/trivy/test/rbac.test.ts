import { describe, expect, it } from "vitest";

import {
  describeRbac,
  getRoleFindings,
  groupByCheck,
  hostListOf,
  type RbacReport,
  roleCounts,
  rolesAffected,
  summariseRbac,
} from "../src/renderer/api/rbac";
import { countOf, toneOf } from "../src/renderer/api/severity";
import { allRbacReports, clusterRbacReports } from "./fixtures";

// The operator writes a ClusterRole's namespace label empty; empty must not read as absent.

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

    // An unstated result is not a failure.
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

describe("what the RBAC list says about each check", () => {
  it("splits a check's roles into Roles and ClusterRoles, adding up to all of them", () => {
    const groups = groupByCheck(getRoleFindings(allRbacReports()));

    expect(groups.some((group) => roleCounts(group).clusterRoles > 0)).toBe(true);
    expect(groups.some((group) => roleCounts(group).roles > 0)).toBe(true);
    for (const group of groups) {
      const counts = roleCounts(group);

      expect(counts.roles + counts.clusterRoles).toBe(group.findings.length);
    }
  });

  it("counts the criticals and the roles in its subline", () => {
    const findings = getRoleFindings(allRbacReports());
    const criticals = countOf(summariseRbac(findings), "CRITICAL");

    expect(describeRbac(findings)).toBe(
      `${criticals} critical grants across ${rolesAffected(findings)} roles. ClusterRoles reach every namespace, so they are listed whichever namespaces are selected.`,
    );
  });

  it("says one grant and one role in the singular", () => {
    const [one] = getRoleFindings(clusterRbacReports()).filter(
      (finding) => finding.check.severity === "CRITICAL",
    );

    expect(one).toBeDefined();
    expect(describeRbac([one as NonNullable<typeof one>])).toMatch(
      /^1 critical grant across 1 role\./,
    );
  });

  it("says nothing under the title when no role fails a check; the empty list says why", () => {
    expect(describeRbac([])).toBeUndefined();
  });

  it("opens a role in the host's list of its kind, narrowed to its name", () => {
    const findings = getRoleFindings(allRbacReports());
    const clusterRole = findings.find((finding) => finding.clusterScoped);
    const role = findings.find((finding) => !finding.clusterScoped);

    expect(hostListOf(clusterRole as NonNullable<typeof clusterRole>)).toBe(
      `/cluster-roles?search=${encodeURIComponent(clusterRole?.subject.name ?? "")}`,
    );
    expect(hostListOf(role as NonNullable<typeof role>)).toBe(
      `/roles?search=${encodeURIComponent(role?.subject.name ?? "")}`,
    );
  });

  it("gives a drawer the tone of its severity: critical and high are acted on", () => {
    expect(toneOf("CRITICAL")).toBe("critical");
    expect(toneOf("HIGH")).toBe("warning");
    expect(toneOf("MEDIUM")).toBe("info");
    expect(toneOf(undefined)).toBe("info");
  });
});
