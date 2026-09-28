/**
 * Shapes as the Trivy operator writes them, read off a live cluster rather than
 * off the upstream schema. Everything under `report` is optional in practice:
 * an object exists from the moment the operator claims the subject, and the
 * fields arrive when a scan finishes — which for a scan that fails is never.
 */

export interface TrivyKubeObjectCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

/** The operator's own severity ladder. `UNKNOWN` is a real value, not a fallback. */
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | "NONE";

export interface SeveritySummary {
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
  unknownCount?: number;
  noneCount?: number;
}

export interface Artifact {
  repository?: string;
  tag?: string;
  digest?: string;
}

export interface Registry {
  server?: string;
}

export interface Scanner {
  name?: string;
  vendor?: string;
  version?: string;
}

export interface Vulnerability {
  vulnerabilityID?: string;
  resource?: string;
  installedVersion?: string;
  /** Empty string when no fix has been published, which is the difference between actionable and not. */
  fixedVersion?: string;
  severity?: Severity;
  score?: number;
  title?: string;
  primaryLink?: string;
  publishedDate?: string;
  lastModifiedDate?: string;
  /** Which artefact inside the image carried it. Empty for Go modules, which is why rows repeat. */
  target?: string;
}

export interface VulnerabilityReportBody {
  artifact?: Artifact;
  registry?: Registry;
  scanner?: Scanner;
  summary?: SeveritySummary;
  os?: { family?: string; name?: string };
  updateTimestamp?: string;
  vulnerabilities?: Vulnerability[];
}

export interface ConfigAuditCheck {
  checkID?: string;
  title?: string;
  description?: string;
  remediation?: string;
  severity?: Severity;
  category?: string;
  success?: boolean;
  messages?: string[];
}

export interface ConfigAuditReportBody {
  scanner?: Scanner;
  summary?: SeveritySummary;
  updateTimestamp?: string;
  checks?: ConfigAuditCheck[];
}

/** Same shape as a config audit: the operator uses one plugin for both. */
export interface RbacAssessmentReportBody {
  scanner?: Scanner;
  summary?: SeveritySummary;
  updateTimestamp?: string;
  checks?: ConfigAuditCheck[];
}

export interface SbomReportBody {
  artifact?: Artifact;
  registry?: Registry;
  scanner?: Scanner;
  summary?: SeveritySummary;
  updateTimestamp?: string;
}

export interface ExposedSecretReportBody {
  artifact?: Artifact;
  registry?: Registry;
  scanner?: Scanner;
  summary?: SeveritySummary;
  updateTimestamp?: string;
  secrets?: { ruleID?: string; title?: string; severity?: Severity; target?: string }[];
}

/**
 * Which cluster object a report is about. The operator puts this in labels
 * rather than in ownerReferences, so it survives the subject being deleted —
 * and it is how every report kind is joined to every other.
 */
export interface ReportSubject {
  namespace: string;
  kind: string;
  name: string;
}
