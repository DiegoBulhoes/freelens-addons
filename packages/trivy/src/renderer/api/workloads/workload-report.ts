import {
  addSummaries,
  compareSeverity,
  countOf,
  criticalOrHighOf,
  rankOf,
} from "../shared/severity";
import { containerOf, type Reporting, subjectKey, subjectOf } from "../shared/subjects";
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
} from "../shared/types";
import {
  deduplicate,
  failedChecks,
  hasFix,
  isAtLeast,
  type PackageUpgrade,
  upgradesThatWouldFix,
} from "../vulnerabilities/findings";
import { COVERAGE_STATUS, type CoverageState } from "./coverage";

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
  endOfLife: boolean;
  scannedAt?: string;
  scanner?: string;
}

export interface ExposedSecret {
  /** Unique within the workload: a rule can match one file twice. */
  key: string;
  severity: Severity;
  title?: string;
  target?: string;
  ruleID?: string;
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
  exposedSecrets: ExposedSecret[];
  hasVulnerabilityReport: boolean;
  hasConfigAuditReport: boolean;
}

function atLeast(report: WorkloadReport, floor: Severity): Vulnerability[] {
  return report.vulnerabilities.filter((each) => isAtLeast(each, floor));
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

export const END_OF_LIFE = "end of life: findings are incomplete";

export function isEndOfLife(body: VulnerabilityReportBody | undefined): boolean {
  return body?.os?.eosl === true;
}

/** "debian 10.13", with a warning when its distribution is past end of life. */
export function describeBase(body: VulnerabilityReportBody | undefined): string | undefined {
  const os = osOf(body);

  if (!os) return undefined;

  return isEndOfLife(body) ? `${os}, ${END_OF_LIFE}` : os;
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
    endOfLife: isEndOfLife(report.report),
    scannedAt: report.report?.updateTimestamp,
    scanner: scannerOf(report.report),
  }));
}

// Field by field: the operator's `match` holds the matched text, which is never shown.
function exposedSecretsOf(reports: Reporting<ExposedSecretReportBody>[]): ExposedSecret[] {
  const seen = new Map<string, number>();

  return reports
    .flatMap((report) => report.report?.secrets ?? [])
    .map(({ severity, title, target, ruleID }) => {
      const base = `${ruleID ?? ""}\u0000${target ?? ""}`;
      const repeat = seen.get(base) ?? 0;

      seen.set(base, repeat + 1);

      return {
        key: `${base}\u0000${repeat}`,
        severity: severity ?? "UNKNOWN",
        title,
        target,
        ruleID,
      };
    })
    .sort((first, second) => compareSeverity(first.severity, second.severity));
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
  const secrets = exposedSecretsOf(exposedSecret);

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
      .flatMap((report) => failedChecks(report.report?.checks))
      .sort((first, second) => compareSeverity(first.severity, second.severity)),
    configSummary: addSummaries(configAudit.map((report) => report.report?.summary)),
    exposedSecrets: secrets,
    hasVulnerabilityReport: vulnerability.length > 0,
    hasConfigAuditReport: configAudit.length > 0,
  };
}

export function upgradesClearing(report: WorkloadReport, floor: Severity): PackageUpgrade[] {
  return report.upgrades.filter((upgrade) => rankOf(upgrade.worstSeverity) <= rankOf(floor));
}

/** "3 more upgrades clear only medium or lower findings.", or undefined when there are none. */
export function describeLowerUpgrades(
  report: WorkloadReport,
  floor: Severity = "HIGH",
): string | undefined {
  const lower = report.upgrades.length - upgradesClearing(report, floor).length;

  if (lower === 0) return undefined;

  return `${lower} more ${lower === 1 ? "upgrade clears" : "upgrades clear"} only findings below ${floor.toLowerCase()}, left out here.`;
}

export interface ActionSummary {
  upgradeCount: number;
  clearedCount: number;
  unfixableCount: number;
}

export function summariseAction(report: WorkloadReport, floor: Severity = "HIGH"): ActionSummary {
  const relevant = atLeast(report, floor);

  return {
    upgradeCount: upgradesClearing(report, floor).length,
    clearedCount: relevant.filter(hasFix).length,
    unfixableCount: relevant.filter((each) => !hasFix(each)).length,
  };
}

export function unfixableOf(report: WorkloadReport, floor: Severity = "HIGH"): Vulnerability[] {
  return atLeast(report, floor).filter((each) => !hasFix(each));
}

export interface WorkloadVerdict {
  tone: Tone;
  label: string;
  reason: string;
}

const UNJUDGED: Record<Exclude<CoverageState, "scanned">, WorkloadVerdict> = {
  "never-looked": {
    ...COVERAGE_STATUS["never-looked"],
    reason:
      "The scanner has not read this workload's images, so what they contain is unknown. No findings here does not mean it is clean.",
  },
  "read-but-no-verdict": {
    ...COVERAGE_STATUS["read-but-no-verdict"],
    reason:
      "The scanner read this workload's images and wrote no vulnerability report, so nobody judged them. No findings here does not mean it is clean.",
  },
  inactive: {
    ...COVERAGE_STATUS.inactive,
    reason:
      "No pod of this ReplicaSet runs, and the operator does not scan a ReplicaSet at zero replicas. Its Deployment's current ReplicaSet is the one judged.",
  },
};

export function workloadVerdict(state: CoverageState, report: WorkloadReport): WorkloadVerdict {
  if (state !== "scanned") return UNJUDGED[state];

  const verdict = scannedVerdict(report);

  if (!report.containers.some((container) => container.endOfLife)) return verdict;

  return {
    ...verdict,
    // Nothing found is not clean when advisories stopped being published.
    tone: verdict.tone === "ok" ? "warning" : verdict.tone,
    reason: `${verdict.reason} An image's base is past its end of life, so its findings are incomplete.`,
  };
}

function scannedVerdict(report: WorkloadReport): WorkloadVerdict {
  // Counted from the deduplicated findings, as the action is: the summary counts repeats.
  const relevant = atLeast(report, "HIGH");
  const counted = criticalOrHighOf(report.summary);

  if (relevant.length === 0 && counted > 0) {
    return {
      tone: countOf(report.summary, "CRITICAL") > 0 ? "critical" : "warning",
      label: `${counted} critical and high findings`,
      reason: "The report counts them without listing them, so no upgrade can be proposed.",
    };
  }

  const criticals = relevant.filter((each) => each.severity === "CRITICAL").length;
  const criticalOrHighCount = relevant.length;

  if (criticalOrHighCount === 0) {
    return { tone: "ok", label: "Scanned", reason: "Nothing critical or high was found." };
  }

  const action = summariseAction(report, "HIGH");

  return {
    tone: criticals > 0 ? "critical" : "warning",
    label:
      action.upgradeCount === 0
        ? "No upgrade published for anything critical or high"
        : `${action.upgradeCount} ${action.upgradeCount === 1 ? "upgrade clears" : "upgrades clear"} ${action.clearedCount} of ${criticalOrHighCount} critical and high findings`,
    reason:
      action.unfixableCount > 0
        ? `${action.unfixableCount} have no published fix, so no upgrade will clear them.`
        : "Every critical and high finding here has a published fix.",
  };
}

// The same upgrades the verdict counts, so the ticket and the banner agree on the job's size.
export function ticketText(report: WorkloadReport, floor: Severity = "HIGH"): string {
  const { subject } = report;

  return [
    `${subject.name} (${subject.namespace}) — ${report.image ?? "no image reported"}`,
    ...upgradesClearing(report, floor).map(
      (upgrade) =>
        `${upgrade.resource} ${upgrade.installedVersion} -> ${upgrade.fixedVersion} (clears ${upgrade.vulnerabilityCount})`,
    ),
  ].join("\n");
}
