import { subjectKey } from "./subjects";
import type { ReportSubject, Tone } from "./types";

const IMAGE_BEARING_KINDS = new Set([
  "ReplicaSet",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "Pod",
  "ReplicationController",
]);

export function bearsAnImage(subject: ReportSubject): boolean {
  return IMAGE_BEARING_KINDS.has(subject.kind);
}

export type CoverageState =
  | "scanned"
  // An SBOM exists, but no vulnerability report.
  | "read-but-no-verdict"
  | "never-looked";

export const COVERAGE_STATUS: Record<CoverageState, { label: string; tone: Tone }> = {
  scanned: { label: "scanned", tone: "ok" },
  "read-but-no-verdict": { label: "no verdict", tone: "warning" },
  "never-looked": { label: "not looked at", tone: "critical" },
};

export interface CoverageEntry {
  subject: ReportSubject;
  state: CoverageState;
}

export interface CoverageTally {
  scanned: number;
  readButNoVerdict: number;
  neverLooked: number;
  total: number;
}

export interface CoverageInput {
  known: ReportSubject[];
  withSbom: Set<string>;
  withVerdict: Set<string>;
}

export function stateOf(subject: ReportSubject, input: CoverageInput): CoverageState {
  const key = subjectKey(subject);

  if (input.withVerdict.has(key)) return "scanned";
  if (input.withSbom.has(key)) return "read-but-no-verdict";

  return "never-looked";
}

// Deduplicated: the operator writes several report kinds per subject.
export function getCoverage(input: CoverageInput): CoverageEntry[] {
  const seen = new Set<string>();
  const entries: CoverageEntry[] = [];

  for (const subject of input.known) {
    if (!bearsAnImage(subject)) continue;

    const key = subjectKey(subject);

    if (seen.has(key)) continue;

    seen.add(key);
    entries.push({ subject, state: stateOf(subject, input) });
  }

  return entries;
}

export function tally(entries: CoverageEntry[]): CoverageTally {
  const counts = { scanned: 0, readButNoVerdict: 0, neverLooked: 0, total: entries.length };

  for (const entry of entries) {
    if (entry.state === "scanned") counts.scanned += 1;
    else if (entry.state === "read-but-no-verdict") counts.readButNoVerdict += 1;
    else counts.neverLooked += 1;
  }

  return counts;
}

export function describeCoverage(counts: CoverageTally): string {
  if (counts.total === 0) return "The Trivy operator has not claimed any workload yet.";

  const unjudged = counts.readButNoVerdict + counts.neverLooked;

  if (unjudged === 0) {
    return `All ${counts.total} workloads have been scanned for vulnerabilities.`;
  }

  return `${counts.scanned} of ${counts.total} workloads have a vulnerability verdict. ${unjudged} do not, so what they contain is unknown.`;
}
