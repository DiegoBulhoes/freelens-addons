import { rankOf } from "./severity";
import { type SubjectBearing, subjectKey, subjectOf } from "./subjects";
import type {
  ConfigAuditCheck,
  RbacAssessmentReportBody,
  ReportSubject,
  SeveritySummary,
} from "./types";

/**
 * What a role is allowed to do that it probably should not be.
 *
 * The operator writes one report per Role and ClusterRole, most of them with
 * nothing to say. What matters is the few that grant something dangerous, and
 * the check's own message names which permission it is — so the rows here are
 * findings rather than roles.
 */

export interface RoleFinding {
  subject: ReportSubject;
  /** A ClusterRole has no namespace; the empty label is what says so. */
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

/** Worst first, then cluster-scoped ahead of namespaced: a ClusterRole reaches further. */
function sortFindings(findings: RoleFinding[]): RoleFinding[] {
  return findings.sort((first, second) => {
    const bySeverity = rankOf(first.check.severity) - rankOf(second.check.severity);

    if (bySeverity !== 0) return bySeverity;

    const byScope = Number(second.clusterScoped) - Number(first.clusterScoped);

    if (byScope !== 0) return byScope;

    return subjectKey(first.subject).localeCompare(subjectKey(second.subject));
  });
}

/** Distinct roles in a set of findings, which is smaller than the row count. */
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

/**
 * Grouped by the check rather than by the role. One misconfiguration usually
 * lands on many roles at once, and the fix is the same sentence for all of
 * them, so the group is the unit of work.
 */
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
