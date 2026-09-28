import { rankOf } from "./severity";
import type { Severity, Vulnerability } from "./types";

/**
 * What can actually be done about what was found.
 *
 * A vulnerability with no published fix and one with a fix waiting are the same
 * row in every list Trivy produces, and they are not the same work: one is a
 * version bump, the other is a decision about whether to keep running the
 * image. The split is the whole value of this module.
 */

export function hasFix(vulnerability: Vulnerability): boolean {
  // The operator writes an empty string, not an absent field, when no fix exists.
  return (vulnerability.fixedVersion ?? "") !== "";
}

/**
 * What makes two rows the same finding. The operator emits one row per Go
 * binary embedding a module, with an empty `target`, so an image can carry the
 * same CVE for the same package version many times over — 140 of one image's
 * rows on the cluster this was built against. Counting those separately
 * overstates the work without naming anything new.
 */
export function identityOf(vulnerability: Vulnerability): string {
  return [
    vulnerability.vulnerabilityID ?? "",
    vulnerability.resource ?? "",
    vulnerability.installedVersion ?? "",
    vulnerability.target ?? "",
  ].join("\u0000");
}

/** Keeps the first of each identity, so the order it was given in survives. */
export function deduplicate(vulnerabilities: Vulnerability[]): Vulnerability[] {
  const seen = new Set<string>();

  return vulnerabilities.filter((vulnerability) => {
    const identity = identityOf(vulnerability);

    if (seen.has(identity)) return false;

    seen.add(identity);

    return true;
  });
}

export function isAtLeast(vulnerability: Vulnerability, floor: Severity): boolean {
  return rankOf(vulnerability.severity) <= rankOf(floor);
}

export interface FixableTally {
  fixable: number;
  unfixable: number;
}

/** Counts at or above `floor`, split by whether a fix has been published. */
export function tallyFixable(vulnerabilities: Vulnerability[], floor: Severity): FixableTally {
  const counts = { fixable: 0, unfixable: 0 };

  for (const vulnerability of vulnerabilities) {
    if (!isAtLeast(vulnerability, floor)) continue;

    if (hasFix(vulnerability)) counts.fixable += 1;
    else counts.unfixable += 1;
  }

  return counts;
}

/** Worst first, then by score, then by id so the order does not wander between renders. */
export function sortBySeverity(vulnerabilities: Vulnerability[]): Vulnerability[] {
  return [...vulnerabilities].sort((first, second) => {
    const bySeverity = rankOf(first.severity) - rankOf(second.severity);

    if (bySeverity !== 0) return bySeverity;

    const byScore = (second.score ?? 0) - (first.score ?? 0);

    if (byScore !== 0) return byScore;

    return (first.vulnerabilityID ?? "").localeCompare(second.vulnerabilityID ?? "");
  });
}

/**
 * One line per distinct package, because a base image drags in the same fix
 * dozens of times and a list that repeats it hides how few actions there are.
 */
export interface PackageUpgrade {
  resource: string;
  installedVersion: string;
  fixedVersion: string;
  worstSeverity: Severity;
  vulnerabilityCount: number;
}

export function upgradesThatWouldFix(vulnerabilities: Vulnerability[]): PackageUpgrade[] {
  const byPackage = new Map<string, PackageUpgrade>();

  for (const vulnerability of vulnerabilities) {
    if (!hasFix(vulnerability)) continue;

    const resource = vulnerability.resource ?? "";
    const installedVersion = vulnerability.installedVersion ?? "";
    const fixedVersion = vulnerability.fixedVersion as string;
    const key = `${resource}@${installedVersion}`;
    const existing = byPackage.get(key);

    if (!existing) {
      byPackage.set(key, {
        resource,
        installedVersion,
        fixedVersion,
        worstSeverity: vulnerability.severity ?? "UNKNOWN",
        vulnerabilityCount: 1,
      });

      continue;
    }

    existing.vulnerabilityCount += 1;

    if (rankOf(vulnerability.severity) < rankOf(existing.worstSeverity)) {
      existing.worstSeverity = vulnerability.severity ?? "UNKNOWN";
      existing.fixedVersion = fixedVersion;
    }
  }

  return [...byPackage.values()].sort((first, second) => {
    const bySeverity = rankOf(first.worstSeverity) - rankOf(second.worstSeverity);

    if (bySeverity !== 0) return bySeverity;

    return second.vulnerabilityCount - first.vulnerabilityCount;
  });
}
