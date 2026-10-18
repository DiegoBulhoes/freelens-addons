import { ROLE_LISTS, searchListOf } from "../shared/host-links";
import { ClusterRbacAssessmentReport, RbacAssessmentReport } from "../shared/kinds";
import { compareSeverity, countOf, rankOf, summaryOf } from "../shared/severity";
import { describeGap, type Failures, type LoadedKind } from "../shared/store-state";
import { type Reporting, subjectKey, subjectOf } from "../shared/subjects";
import type {
  ConfigAuditCheck,
  RbacAssessmentReportBody,
  ReportSubject,
  SeveritySummary,
} from "../shared/types";
import { failedChecks } from "../vulnerabilities/findings";

export const ROLE_REPORTS: LoadedKind = { kind: RbacAssessmentReport.kind, namespaced: true };
export const CLUSTER_ROLE_REPORTS: LoadedKind = {
  kind: ClusterRbacAssessmentReport.kind,
  namespaced: false,
};

// A namespace-limited user cannot list ClusterRoles, and the Roles they can read still list.
export const RBAC_REQUIRED: readonly LoadedKind[] = [ROLE_REPORTS];

export function rbacGaps(failures: Failures): string[] {
  return [
    describeGap(failures, [ROLE_REPORTS.kind], "Roles there are left out of the list."),
    describeGap(failures, [CLUSTER_ROLE_REPORTS.kind], "ClusterRoles are left out of the list."),
  ].filter((gap) => gap !== undefined);
}

export interface RoleFinding {
  subject: ReportSubject;
  clusterScoped: boolean;
  check: ConfigAuditCheck;
}

export type RbacReport = Reporting<RbacAssessmentReportBody>;

export function getRoleFindings(reports: RbacReport[]): RoleFinding[] {
  const findings: RoleFinding[] = [];

  for (const report of reports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    for (const check of failedChecks(report.report?.checks)) {
      findings.push({ subject, clusterScoped: subject.namespace === "", check });
    }
  }

  return sortFindings(findings);
}

function sortFindings(findings: RoleFinding[]): RoleFinding[] {
  return findings.sort((first, second) => {
    const bySeverity = compareSeverity(first.check.severity, second.check.severity);

    if (bySeverity !== 0) return bySeverity;

    const byScope = Number(second.clusterScoped) - Number(first.clusterScoped);

    if (byScope !== 0) return byScope;

    return subjectKey(first.subject).localeCompare(subjectKey(second.subject));
  });
}

export function rolesAffected(findings: RoleFinding[]): number {
  return new Set(findings.map((finding) => subjectKey(finding.subject))).size;
}

export interface CheckGroup {
  checkID: string;
  title: string;
  severity: ConfigAuditCheck["severity"];
  remediation?: string;
  findings: RoleFinding[];
}

export function groupByCheck(findings: RoleFinding[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>();

  for (const finding of findings) {
    const checkID = finding.check.checkID ?? "";
    const existing = groups.get(checkID);

    if (existing) {
      existing.findings.push(finding);

      continue;
    }

    groups.set(checkID, {
      checkID,
      title: finding.check.title ?? checkID,
      severity: finding.check.severity,
      remediation: finding.check.remediation,
      findings: [finding],
    });
  }

  return [...groups.values()].sort((first, second) => {
    const bySeverity = compareSeverity(first.severity, second.severity);

    if (bySeverity !== 0) return bySeverity;

    return second.findings.length - first.findings.length;
  });
}

export function summariseRbac(findings: RoleFinding[]): SeveritySummary {
  return summaryOf(findings.map((finding) => finding.check.severity));
}

export function roleCounts(group: CheckGroup): { roles: number; clusterRoles: number } {
  const clusterRoles = group.findings.filter((finding) => finding.clusterScoped).length;

  return { roles: group.findings.length - clusterRoles, clusterRoles };
}

export type CheckColumn = "Severity" | "Check" | "ID" | "Roles" | "ClusterRoles";

// Severity sorts by rank: ascending is worst first.
export function checkSortValue(group: CheckGroup, column: string): string | number | undefined {
  const counts = roleCounts(group);

  switch (column as CheckColumn) {
    case "Severity":
      return rankOf(group.severity);
    case "Check":
      return group.title;
    case "ID":
      return group.checkID || undefined;
    case "Roles":
      return counts.roles;
    case "ClusterRoles":
      return counts.clusterRoles;
    default:
      return undefined;
  }
}

export function checkSearchTexts(group: CheckGroup): string[] {
  return [
    group.checkID,
    group.title,
    group.severity ?? "UNKNOWN",
    ...group.findings.flatMap((finding) => [finding.subject.name, finding.subject.namespace]),
  ];
}

export function describeRbac(findings: RoleFinding[]): string | undefined {
  if (findings.length === 0) return undefined;

  const criticals = countOf(summariseRbac(findings), "CRITICAL");
  const roles = rolesAffected(findings);

  return `${criticals} critical ${criticals === 1 ? "grant" : "grants"} across ${roles} ${roles === 1 ? "role" : "roles"}. ClusterRoles reach every namespace, so they are listed whichever namespaces are selected.`;
}

export function roleListOf(finding: RoleFinding): string {
  return searchListOf(
    finding.clusterScoped ? ROLE_LISTS.ClusterRole : ROLE_LISTS.Role,
    finding.subject.name,
  );
}
