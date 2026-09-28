import {
  deduplicate,
  hasFix,
  isAtLeast,
  type PackageUpgrade,
  upgradesThatWouldFix,
} from "./findings";
import { addSummaries, rankOf } from "./severity";
import { containerOf, type SubjectBearing, subjectKey, subjectOf } from "./subjects";
import type {
  ConfigAuditCheck,
  ConfigAuditReportBody,
  ExposedSecretReportBody,
  ReportSubject,
  Severity,
  SeveritySummary,
  Vulnerability,
  VulnerabilityReportBody,
} from "./types";

/**
 * Everything Trivy knows about one workload, gathered from the four report
 * kinds that each cover part of it.
 *
 * The page built on this opens with what to do rather than with how much is
 * wrong: three upgrades clearing nine criticals is work someone can start, and
 * a count of 408 findings is not.
 */

export interface Reporting<Body> extends SubjectBearing {
  report?: Body;
}

export interface WorkloadReports {
  vulnerability: Reporting<VulnerabilityReportBody>[];
  configAudit: Reporting<ConfigAuditReportBody>[];
  exposedSecret: Reporting<ExposedSecretReportBody>[];
}

/** What one container of the workload runs, and what judged it. */
export interface ScannedContainer {
  name?: string;
  image?: string;
  digest?: string;
  registry?: string;
  operatingSystem?: string;
  scannedAt?: string;
  scanner?: string;
}

export interface WorkloadReport {
  subject: ReportSubject;
  /** One entry per container: the operator writes a report for each, with its own image. */
  containers: ScannedContainer[];
  image?: string;
  operatingSystem?: string;
  scannedAt?: string;
  summary: SeveritySummary;
  vulnerabilities: Vulnerability[];
  /** Ordered worst-severity first, then by how many findings each upgrade clears. */
  upgrades: PackageUpgrade[];
  failedChecks: ConfigAuditCheck[];
  configSummary: SeveritySummary;
  exposedSecretCount: number;
  hasVulnerabilityReport: boolean;
  hasConfigAuditReport: boolean;
}

function reportsFor<Body>(reports: Reporting<Body>[], subject: ReportSubject) {
  const wanted = subjectKey(subject);

  return reports.filter((report) => {
    const found = subjectOf(report);

    return found !== undefined && subjectKey(found) === wanted;
  });
}

function imageOf(body: VulnerabilityReportBody | undefined): string | undefined {
  const artifact = body?.artifact;

  if (!artifact?.repository) return undefined;

  return artifact.tag ? `${artifact.repository}:${artifact.tag}` : artifact.repository;
}

function osOf(body: VulnerabilityReportBody | undefined): string | undefined {
  if (!body?.os?.name) return undefined;

  return `${body.os.family ?? ""} ${body.os.name}`.trim();
}

function containersOf(reports: Reporting<VulnerabilityReportBody>[]): ScannedContainer[] {
  return reports.map((report) => ({
    name: containerOf(report),
    image: imageOf(report.report),
    digest: report.report?.artifact?.digest,
    registry: report.report?.registry?.server,
    operatingSystem: osOf(report.report),
    scannedAt: report.report?.updateTimestamp,
    scanner: report.report?.scanner?.version
      ? `${report.report.scanner.name ?? "Trivy"} ${report.report.scanner.version}`
      : undefined,
  }));
}

export function getWorkloadReport(
  subject: ReportSubject,
  reports: WorkloadReports,
): WorkloadReport {
  const vulnerability = reportsFor(reports.vulnerability, subject);
  const configAudit = reportsFor(reports.configAudit, subject);
  const exposedSecret = reportsFor(reports.exposedSecret, subject);

  // A workload with several containers gets one report per container, so every
  // field here is gathered across them rather than taken from the first.
  // Deduplicated here, once, so every count downstream is of distinct findings.
  const vulnerabilities = deduplicate(
    vulnerability.flatMap((report) => report.report?.vulnerabilities ?? []),
  );
  const body = vulnerability[0]?.report;

  return {
    subject,
    containers: containersOf(vulnerability),
    image: imageOf(body),
    operatingSystem: osOf(body),
    scannedAt: body?.updateTimestamp,
    summary: addSummaries(vulnerability.map((report) => report.report?.summary)),
    vulnerabilities,
    upgrades: upgradesThatWouldFix(vulnerabilities),
    failedChecks: configAudit
      .flatMap((report) => report.report?.checks ?? [])
      .filter((check) => check.success === false)
      .sort((first, second) => rankOf(first.severity) - rankOf(second.severity)),
    configSummary: addSummaries(configAudit.map((report) => report.report?.summary)),
    exposedSecretCount: exposedSecret.reduce(
      (running, report) => running + (report.report?.secrets?.length ?? 0),
      0,
    ),
    hasVulnerabilityReport: vulnerability.length > 0,
    hasConfigAuditReport: configAudit.length > 0,
  };
}

/** How many upgrades it takes to clear everything at or above `floor`. */
export function upgradesClearing(report: WorkloadReport, floor: Severity): PackageUpgrade[] {
  return report.upgrades.filter((upgrade) => rankOf(upgrade.worstSeverity) <= rankOf(floor));
}

export interface ActionSummary {
  upgradeCount: number;
  clearedCount: number;
  unfixableCount: number;
}

/**
 * The sentence at the top of the page. It counts upgrades, not findings,
 * because an upgrade is the unit of work — one bump of openssl answers
 * thirty-two rows.
 */
export function summariseAction(report: WorkloadReport, floor: Severity = "HIGH"): ActionSummary {
  const relevant = report.vulnerabilities.filter((each) => isAtLeast(each, floor));

  return {
    upgradeCount: upgradesClearing(report, floor).length,
    clearedCount: relevant.filter(hasFix).length,
    unfixableCount: relevant.filter((each) => !hasFix(each)).length,
  };
}
