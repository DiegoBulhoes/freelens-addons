// Everything under `report` may be absent: a failed scan never fills it.

export interface TrivyKubeObjectCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export type Tone = "critical" | "warning" | "info" | "ok";

// `UNKNOWN` is a real value, not a fallback.
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
  // Empty string when no fix is published.
  fixedVersion?: string;
  severity?: Severity;
  score?: number;
  title?: string;
  primaryLink?: string;
  publishedDate?: string;
  lastModifiedDate?: string;
  // Empty for Go modules, which is why rows repeat.
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

export interface ReportSubject {
  namespace: string;
  kind: string;
  name: string;
}
