import { countOf, rankOf } from "./severity";
import { type SubjectBearing, subjectKey, subjectOf } from "./subjects";
import type {
  ConfigAuditCheck,
  RbacAssessmentReportBody,
  ReportSubject,
  SeveritySummary,
} from "./types";

export interface RoleFinding {
  subject: ReportSubject;
  clusterScoped: boolean;
  check: ConfigAuditCheck;
}

export interface RbacReport extends SubjectBearing {
  report?: RbacAssessmentReportBody;
}

export function getRoleFindings(reports: RbacReport[]): RoleFinding[] {
  const findings: RoleFinding[] = [];

  for (const report of reports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    for (const check of report.report?.checks ?? []) {
      if (check.success !== false) continue;

      findings.push({ subject, clusterScoped: subject.namespace === "", check });
    }
  }

  return sortFindings(findings);
}

function sortFindings(findings: RoleFinding[]): RoleFinding[] {
  return findings.sort((first, second) => {
    const bySeverity = rankOf(first.check.severity) - rankOf(second.check.severity);

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
    const bySeverity = rankOf(first.severity) - rankOf(second.severity);

    if (bySeverity !== 0) return bySeverity;

    return second.findings.length - first.findings.length;
  });
}

export function summariseRbac(findings: RoleFinding[]): SeveritySummary {
  const summary: SeveritySummary = {};
  const field = {
    CRITICAL: "criticalCount",
    HIGH: "highCount",
    MEDIUM: "mediumCount",
    LOW: "lowCount",
    UNKNOWN: "unknownCount",
    NONE: "noneCount",
  } as const;

  for (const finding of findings) {
    const key = field[finding.check.severity ?? "UNKNOWN"];

    summary[key] = (summary[key] ?? 0) + 1;
  }

  return summary;
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

// A page of ours cannot open the host's drawer; host lists read ?search=.
export function hostListOf(finding: RoleFinding): string {
  const list = finding.clusterScoped ? "/cluster-roles" : "/roles";

  return `${list}?search=${encodeURIComponent(finding.subject.name)}`;
}
