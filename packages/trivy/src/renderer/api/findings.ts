import { rankOf } from "./severity";
import type { Severity, Vulnerability } from "./types";

export function hasFix(vulnerability: Vulnerability): boolean {
  // The operator writes an empty string, not an absent field, when no fix exists.
  return (vulnerability.fixedVersion ?? "") !== "";
}

// The operator emits one row per Go binary embedding a module, with an empty `target`.
export function identityOf(vulnerability: Vulnerability): string {
  return [
    vulnerability.vulnerabilityID ?? "",
    vulnerability.resource ?? "",
    vulnerability.installedVersion ?? "",
    vulnerability.target ?? "",
  ].join("\u0000");
}

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

export function tallyFixable(vulnerabilities: Vulnerability[], floor: Severity): FixableTally {
  const counts = { fixable: 0, unfixable: 0 };

  for (const vulnerability of vulnerabilities) {
    if (!isAtLeast(vulnerability, floor)) continue;

    if (hasFix(vulnerability)) counts.fixable += 1;
    else counts.unfixable += 1;
  }

  return counts;
}

export function sortBySeverity(vulnerabilities: Vulnerability[]): Vulnerability[] {
  return [...vulnerabilities].sort((first, second) => {
    const bySeverity = rankOf(first.severity) - rankOf(second.severity);

    if (bySeverity !== 0) return bySeverity;

    const byScore = (second.score ?? 0) - (first.score ?? 0);

    if (byScore !== 0) return byScore;

    return (first.vulnerabilityID ?? "").localeCompare(second.vulnerabilityID ?? "");
  });
}

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

export function topFixable(vulnerabilities: Vulnerability[], limit: number): Vulnerability[] {
  return sortBySeverity(deduplicate(vulnerabilities).filter(hasFix)).slice(0, limit);
}
