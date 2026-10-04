import type { CoverageState } from "./coverage";
import {
  deduplicate,
  hasFix,
  isAtLeast,
  type PackageUpgrade,
  upgradesThatWouldFix,
} from "./findings";
import { addSummaries, countOf, rankOf } from "./severity";
import { containerOf, type SubjectBearing, subjectKey, subjectOf } from "./subjects";
import type {
  ConfigAuditCheck,
  ConfigAuditReportBody,
  ExposedSecretReportBody,
  ReportSubject,
  Severity,
  SeveritySummary,
  Tone,
  Vulnerability,
  VulnerabilityReportBody,
} from "./types";

export interface Reporting<Body> extends SubjectBearing {
  report?: Body;
}

export interface WorkloadReports {
  vulnerability: Reporting<VulnerabilityReportBody>[];
  configAudit: Reporting<ConfigAuditReportBody>[];
  exposedSecret: Reporting<ExposedSecretReportBody>[];
}

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
  containers: ScannedContainer[];
  image?: string;
  operatingSystem?: string;
  scannedAt?: string;
  summary: SeveritySummary;
  vulnerabilities: Vulnerability[];
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

export function imageOf(body: VulnerabilityReportBody | undefined): string | undefined {
  const artifact = body?.artifact;

  if (!artifact?.repository) return undefined;

  return artifact.tag ? `${artifact.repository}:${artifact.tag}` : artifact.repository;
}

export function osOf(body: VulnerabilityReportBody | undefined): string | undefined {
  if (!body?.os?.name) return undefined;

  return `${body.os.family ?? ""} ${body.os.name}`.trim();
}

export function scannerOf(body: VulnerabilityReportBody | undefined): string | undefined {
  const scanner = body?.scanner;

  if (!scanner?.version) return undefined;

  return `${scanner.name ?? "Trivy"} ${scanner.version}`;
}

function containersOf(reports: Reporting<VulnerabilityReportBody>[]): ScannedContainer[] {
  return reports.map((report) => ({
    name: containerOf(report),
    image: imageOf(report.report),
    digest: report.report?.artifact?.digest,
    registry: report.report?.registry?.server,
    operatingSystem: osOf(report.report),
    scannedAt: report.report?.updateTimestamp,
    scanner: scannerOf(report.report),
  }));
}

export function getWorkloadReport(
  subject: ReportSubject,
  reports: WorkloadReports,
): WorkloadReport {
  const vulnerability = reportsFor(reports.vulnerability, subject);
  const configAudit = reportsFor(reports.configAudit, subject);
  const exposedSecret = reportsFor(reports.exposedSecret, subject);

  // One report per container: gathered across all, deduplicated once.
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

export function upgradesClearing(report: WorkloadReport, floor: Severity): PackageUpgrade[] {
  return report.upgrades.filter((upgrade) => rankOf(upgrade.worstSeverity) <= rankOf(floor));
}

export interface ActionSummary {
  upgradeCount: number;
  clearedCount: number;
  unfixableCount: number;
}

export function summariseAction(report: WorkloadReport, floor: Severity = "HIGH"): ActionSummary {
  const relevant = report.vulnerabilities.filter((each) => isAtLeast(each, floor));

  return {
    upgradeCount: upgradesClearing(report, floor).length,
    clearedCount: relevant.filter(hasFix).length,
    unfixableCount: relevant.filter((each) => !hasFix(each)).length,
  };
}

export function unfixableOf(report: WorkloadReport, floor: Severity = "HIGH"): Vulnerability[] {
  return report.vulnerabilities.filter((each) => isAtLeast(each, floor) && !hasFix(each));
}

export interface WorkloadVerdict {
  tone: Tone;
  label: string;
  reason: string;
}

const UNJUDGED: Record<Exclude<CoverageState, "scanned">, WorkloadVerdict> = {
  "never-looked": {
    tone: "critical",
    label: "Not looked at",
    reason:
      "The scanner has not read this workload's images, so what they contain is unknown. No findings here does not mean it is clean.",
  },
  "read-but-no-verdict": {
    tone: "warning",
    label: "No verdict",
    reason:
      "The scanner read this workload's images and wrote no vulnerability report, so nobody judged them. No findings here does not mean it is clean.",
  },
};

export function workloadVerdict(state: CoverageState, report: WorkloadReport): WorkloadVerdict {
  if (state !== "scanned") return UNJUDGED[state];

  const criticals = countOf(report.summary, "CRITICAL");
  const worst = criticals + countOf(report.summary, "HIGH");

  if (worst === 0) {
    return { tone: "ok", label: "Scanned", reason: "Nothing critical or high was found." };
  }

  const action = summariseAction(report, "HIGH");

  return {
    tone: criticals > 0 ? "critical" : "warning",
    label:
      action.upgradeCount === 0
        ? "No upgrade published for anything critical or high"
        : `${action.upgradeCount} ${action.upgradeCount === 1 ? "upgrade clears" : "upgrades clear"} ${action.clearedCount} of ${worst} critical and high findings`,
    reason:
      action.unfixableCount > 0
        ? `${action.unfixableCount} have no published fix, so no upgrade will clear them.`
        : "Every critical and high finding here has a published fix.",
  };
}

export function ticketText(report: WorkloadReport): string {
  const { subject } = report;

  return [
    `${subject.name} (${subject.namespace}) — ${report.image ?? "no image reported"}`,
    ...report.upgrades.map(
      (upgrade) =>
        `${upgrade.resource} ${upgrade.installedVersion} -> ${upgrade.fixedVersion} (clears ${upgrade.vulnerabilityCount})`,
    ),
  ].join("\n");
}
