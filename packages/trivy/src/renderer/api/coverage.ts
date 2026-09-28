import { subjectKey } from "./subjects";
import type { ReportSubject } from "./types";

/**
 * Whether the operator actually reached a verdict on each workload.
 *
 * This exists because an absent VulnerabilityReport is indistinguishable, in
 * any list of them, from a workload with nothing wrong. It is not the same
 * thing: on the cluster this was written against, 74 workloads had their image
 * read and 8 had a verdict, because the scan job died decoding the SBOM it had
 * just written. Reading that list of 8 as "the cluster has 17 critical issues"
 * understates it by an unknown amount, and nothing on screen said so.
 */

/** Kinds the operator scans images for. A Service or a NetworkPolicy has no image. */
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
  /** A verdict was reached. Its findings can be trusted to be about this workload. */
  | "scanned"
  /** The image was read — an SBOM exists — but no verdict followed. */
  | "read-but-no-verdict"
  /** The operator knows the workload and has neither read its image nor judged it. */
  | "never-looked";

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
  /** Every subject the operator has claimed, from whichever report kind names it. */
  known: ReportSubject[];
  /** Subjects with an SBOM: the image was pulled and read. */
  withSbom: Set<string>;
  /** Subjects with a vulnerability report: a verdict exists. */
  withVerdict: Set<string>;
}

export function stateOf(subject: ReportSubject, input: CoverageInput): CoverageState {
  const key = subjectKey(subject);

  if (input.withVerdict.has(key)) return "scanned";
  if (input.withSbom.has(key)) return "read-but-no-verdict";

  return "never-looked";
}

/** One entry per image-bearing workload, deduplicated: the operator writes several report kinds per subject. */
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

/**
 * The sentence the overview opens with. It never claims a clean cluster on the
 * strength of reports that do not exist.
 */
export function describeCoverage(counts: CoverageTally): string {
  if (counts.total === 0) return "The Trivy operator has not claimed any workload yet.";

  const unjudged = counts.readButNoVerdict + counts.neverLooked;

  if (unjudged === 0) {
    return `All ${counts.total} workloads have been scanned for vulnerabilities.`;
  }

  return `${counts.scanned} of ${counts.total} workloads have a vulnerability verdict. ${unjudged} do not, so what they contain is unknown.`;
}
