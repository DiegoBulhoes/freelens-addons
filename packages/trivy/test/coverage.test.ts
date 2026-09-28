import { describe, expect, it } from "vitest";

import {
  bearsAnImage,
  type CoverageInput,
  describeCoverage,
  getCoverage,
  stateOf,
  tally,
} from "../src/renderer/api/coverage";
import { subjectKey, subjectOf } from "../src/renderer/api/subjects";
import type { ReportSubject } from "../src/renderer/api/types";
import { configAuditReports, sbomReports, vulnerabilityReports } from "./fixtures";

/**
 * The question this extension exists to answer. A workload with no
 * VulnerabilityReport looks, in any list of reports, exactly like a workload
 * with nothing wrong — and on the cluster these fixtures came from those are
 * overwhelmingly not the same thing.
 */

function keysOf(reports: { getLabels(): string[]; getOwnerRefs(): { name: string }[] }[]) {
  return new Set(
    reports
      .map(subjectOf)
      .filter((subject) => subject !== undefined)
      .map(subjectKey),
  );
}

/** Built the way the page builds it: every report kind contributes what it knows. */
function clusterCoverage(): CoverageInput {
  const known = [...configAuditReports(), ...sbomReports(), ...vulnerabilityReports()]
    .map(subjectOf)
    .filter((subject) => subject !== undefined);

  return { known, withSbom: keysOf(sbomReports()), withVerdict: keysOf(vulnerabilityReports()) };
}

const workload = (name: string): ReportSubject => ({
  namespace: "argocd",
  kind: "ReplicaSet",
  name,
});

describe("deciding what the scanner actually covered", () => {
  it("finds workloads whose image was read but never judged", () => {
    const counts = tally(getCoverage(clusterCoverage()));

    // The state these fixtures were taken in, and the reason for this module.
    expect(counts.readButNoVerdict).toBeGreaterThan(0);
    expect(counts.scanned).toBeLessThan(counts.total);
  });

  it("counts every workload exactly once across the three states", () => {
    const counts = tally(getCoverage(clusterCoverage()));

    expect(counts.scanned + counts.readButNoVerdict + counts.neverLooked).toBe(counts.total);
  });

  it("calls a workload scanned only when a verdict exists, not merely an SBOM", () => {
    const input: CoverageInput = {
      known: [workload("judged"), workload("read-only")],
      withSbom: new Set([subjectKey(workload("judged")), subjectKey(workload("read-only"))]),
      withVerdict: new Set([subjectKey(workload("judged"))]),
    };

    expect(stateOf(workload("judged"), input)).toBe("scanned");
    expect(stateOf(workload("read-only"), input)).toBe("read-but-no-verdict");
  });

  it("deduplicates a subject named by several report kinds", () => {
    const input: CoverageInput = {
      known: [workload("web"), workload("web"), workload("web")],
      withSbom: new Set(),
      withVerdict: new Set(),
    };

    expect(getCoverage(input)).toHaveLength(1);
  });

  it("leaves out kinds that carry no image, which cannot be scanned for one", () => {
    const input: CoverageInput = {
      known: [
        workload("web"),
        { namespace: "argocd", kind: "Service", name: "web" },
        { namespace: "argocd", kind: "NetworkPolicy", name: "default-deny" },
      ],
      withSbom: new Set(),
      withVerdict: new Set(),
    };

    expect(getCoverage(input).map((entry) => entry.subject.kind)).toEqual(["ReplicaSet"]);
  });
});

describe("deciding coverage when there is nothing to decide from", () => {
  const empty: CoverageInput = { known: [], withSbom: new Set(), withVerdict: new Set() };

  it("reports nothing rather than claiming a clean cluster", () => {
    expect(tally(getCoverage(empty))).toEqual({
      scanned: 0,
      readButNoVerdict: 0,
      neverLooked: 0,
      total: 0,
    });
    expect(describeCoverage(tally(getCoverage(empty)))).toContain("has not claimed any workload");
  });

  it("calls a workload never-looked-at when neither an SBOM nor a verdict exists", () => {
    expect(stateOf(workload("web"), empty)).toBe("never-looked");
  });

  it("says so plainly when every workload really was judged", () => {
    const input: CoverageInput = {
      known: [workload("web")],
      withSbom: new Set([subjectKey(workload("web"))]),
      withVerdict: new Set([subjectKey(workload("web"))]),
    };

    const sentence = describeCoverage(tally(getCoverage(input)));

    expect(sentence).toBe("All 1 workloads have been scanned for vulnerabilities.");
    expect(sentence).not.toContain("unknown");
  });
});

describe("describing coverage that nobody would want to read about", () => {
  it("never claims a verdict it does not have", () => {
    const sentence = describeCoverage({
      scanned: 8,
      readButNoVerdict: 66,
      neverLooked: 28,
      total: 102,
    });

    expect(sentence).toContain("8 of 102");
    expect(sentence).toContain("94 do not");
    expect(sentence).toContain("unknown");
  });

  it("treats a verdict without an SBOM as scanned, the verdict being the stronger claim", () => {
    const input: CoverageInput = {
      known: [workload("web")],
      withSbom: new Set(),
      withVerdict: new Set([subjectKey(workload("web"))]),
    };

    expect(stateOf(workload("web"), input)).toBe("scanned");
  });

  it("distinguishes two workloads whose names match across namespaces", () => {
    const here: ReportSubject = { namespace: "a", kind: "ReplicaSet", name: "web" };
    const there: ReportSubject = { namespace: "b", kind: "ReplicaSet", name: "web" };
    const input: CoverageInput = {
      known: [here, there],
      withSbom: new Set(),
      withVerdict: new Set([subjectKey(here)]),
    };

    expect(stateOf(here, input)).toBe("scanned");
    expect(stateOf(there, input)).toBe("never-looked");
    expect(getCoverage(input)).toHaveLength(2);
  });

  it("does not treat a Pod as imageless just because it is not a controller", () => {
    expect(bearsAnImage({ namespace: "a", kind: "Pod", name: "one-off" })).toBe(true);
    expect(bearsAnImage({ namespace: "a", kind: "ConfigMap", name: "settings" })).toBe(false);
  });
});
