import { describe, expect, it } from "vitest";

import {
  deduplicate,
  hasFix,
  identityOf,
  isAtLeast,
  sortBySeverity,
  tallyFixable,
  topFixable,
  upgradesThatWouldFix,
} from "../src/renderer/api/findings";
import { addSummaries, countOf, rankOf, totalOf } from "../src/renderer/api/severity";
import type { Vulnerability } from "../src/renderer/api/types";
import { allVulnerabilities, vulnerabilityReports } from "./fixtures";

const found = (over: Partial<Vulnerability> = {}): Vulnerability => ({
  vulnerabilityID: "CVE-2024-0001",
  resource: "openssl",
  installedVersion: "3.0.1",
  fixedVersion: "3.0.2",
  severity: "HIGH",
  score: 7.5,
  ...over,
});

describe("telling apart what can be fixed", () => {
  it("splits the cluster's own criticals by whether a fix exists", () => {
    const counts = tallyFixable(allVulnerabilities(), "CRITICAL");

    expect(counts.fixable + counts.unfixable).toBeGreaterThan(0);
    expect(counts.fixable).toBeGreaterThan(0);
    expect(counts.unfixable).toBeGreaterThan(0);
  });

  it("reads an empty fixedVersion as no fix, which is how the operator writes it", () => {
    expect(hasFix(found({ fixedVersion: "" }))).toBe(false);
    expect(hasFix(found({ fixedVersion: undefined }))).toBe(false);
    expect(hasFix(found({ fixedVersion: "3.0.2" }))).toBe(true);
  });

  it("includes everything at or above the floor, not only the floor itself", () => {
    const counts = tallyFixable(
      [found({ severity: "CRITICAL" }), found({ severity: "HIGH" }), found({ severity: "LOW" })],
      "HIGH",
    );

    expect(counts.fixable).toBe(2);
  });

  it("collapses one package's many findings into one upgrade", () => {
    const upgrades = upgradesThatWouldFix([
      found({ vulnerabilityID: "CVE-1", severity: "HIGH" }),
      found({ vulnerabilityID: "CVE-2", severity: "CRITICAL" }),
      found({ vulnerabilityID: "CVE-3", severity: "LOW" }),
    ]);

    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.vulnerabilityCount).toBe(3);
    expect(upgrades[0]?.worstSeverity).toBe("CRITICAL");
  });

  it("turns a real report into far fewer upgrades than it has findings", () => {
    const worst = vulnerabilityReports()
      .map((report) => report.report?.vulnerabilities ?? [])
      .sort((first, second) => second.length - first.length)[0] as Vulnerability[];

    const upgrades = upgradesThatWouldFix(worst);

    expect(worst.length).toBeGreaterThan(50);
    expect(upgrades.length).toBeLessThan(worst.length);
  });
});

describe("counting findings that are not there", () => {
  it("counts nothing in an empty list without dividing by it", () => {
    expect(tallyFixable([], "CRITICAL")).toEqual({ fixable: 0, unfixable: 0 });
    expect(upgradesThatWouldFix([])).toEqual([]);
    expect(sortBySeverity([])).toEqual([]);
  });

  it("proposes no upgrade when nothing has a fix", () => {
    expect(upgradesThatWouldFix([found({ fixedVersion: "" })])).toEqual([]);
  });

  it("reads a missing summary as no findings rather than throwing", () => {
    expect(totalOf(undefined)).toBe(0);
    expect(countOf(undefined, "CRITICAL")).toBe(0);
    expect(addSummaries([undefined, undefined])).toEqual({});
  });
});

describe("findings shaped in ways the operator should not produce", () => {
  it("sorts an unrecognised severity last, not first", () => {
    const sorted = sortBySeverity([
      found({ severity: "WHATEVER" as never, vulnerabilityID: "CVE-odd" }),
      found({ severity: "LOW", vulnerabilityID: "CVE-low" }),
      found({ severity: "CRITICAL", vulnerabilityID: "CVE-crit" }),
    ]);

    expect(sorted.map((each) => each.vulnerabilityID)).toEqual(["CVE-crit", "CVE-low", "CVE-odd"]);
  });

  it("does not treat an unknown severity as meeting a CRITICAL floor", () => {
    expect(isAtLeast(found({ severity: "UNKNOWN" }), "CRITICAL")).toBe(false);
    expect(rankOf(undefined)).toBeGreaterThan(rankOf("LOW"));
  });

  it("orders two findings of one severity by score, then by id, so it never wanders", () => {
    const first = sortBySeverity([
      found({ vulnerabilityID: "CVE-b", score: 9 }),
      found({ vulnerabilityID: "CVE-a", score: 9 }),
      found({ vulnerabilityID: "CVE-c", score: 10 }),
    ]);

    expect(first.map((each) => each.vulnerabilityID)).toEqual(["CVE-c", "CVE-a", "CVE-b"]);
  });

  it("keeps two versions of one package apart rather than merging their upgrades", () => {
    const upgrades = upgradesThatWouldFix([
      found({ installedVersion: "1.0.0", fixedVersion: "1.0.1" }),
      found({ installedVersion: "2.0.0", fixedVersion: "2.0.1" }),
    ]);

    expect(upgrades).toHaveLength(2);
  });

  it("groups a finding that names no package, rather than dropping it", () => {
    const upgrades = upgradesThatWouldFix([
      { fixedVersion: "1.2.3", severity: "HIGH" },
      { fixedVersion: "1.2.3", severity: "CRITICAL" },
    ]);

    // Malformed rows still count: dropping them would understate the work.
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.resource).toBe("");
    expect(upgrades[0]?.worstSeverity).toBe("CRITICAL");
  });

  it("keeps the first severity when a later finding of the same package is milder", () => {
    const upgrades = upgradesThatWouldFix([
      found({ vulnerabilityID: "CVE-1", severity: "CRITICAL", fixedVersion: "9.9" }),
      found({ vulnerabilityID: "CVE-2", severity: "LOW", fixedVersion: "1.1" }),
    ]);

    expect(upgrades[0]?.worstSeverity).toBe("CRITICAL");
    expect(upgrades[0]?.fixedVersion).toBe("9.9");
  });

  it("sorts two findings with no score and no id without throwing", () => {
    const sorted = sortBySeverity([
      { severity: "HIGH" },
      { severity: "HIGH" },
      { severity: "CRITICAL" },
    ]);

    expect(sorted.map((each) => each.severity)).toEqual(["CRITICAL", "HIGH", "HIGH"]);
  });

  it("orders upgrades of equal severity by how many findings each clears", () => {
    const upgrades = upgradesThatWouldFix([
      found({ resource: "one", vulnerabilityID: "CVE-1" }),
      found({ resource: "two", vulnerabilityID: "CVE-2" }),
      found({ resource: "two", vulnerabilityID: "CVE-3" }),
    ]);

    expect(upgrades.map((each) => each.resource)).toEqual(["two", "one"]);
  });

  it("treats two findings with nothing filled in as the same one", () => {
    expect(deduplicate([{}, {}])).toHaveLength(1);
    expect(identityOf({})).toBe(identityOf({}));
  });

  it("does not invent a summary field that no report carried", () => {
    expect(addSummaries([{ criticalCount: 1 }, { criticalCount: 2 }])).toEqual({
      criticalCount: 3,
    });
  });
});

describe("the worst findings that have a fix", () => {
  it("takes from a real report only fixable findings, worst first, up to the limit", () => {
    const top = topFixable(allVulnerabilities(), 10);

    expect(top).toHaveLength(10);
    for (const each of top) expect(hasFix(each)).toBe(true);
    expect(sortBySeverity(top)).toEqual(top);
    expect(top[0]?.severity).toBe("CRITICAL");
  });

  it("lists a finding emitted twice once", () => {
    expect(topFixable([found(), found()], 10)).toHaveLength(1);
  });

  it("lists nothing when nothing has a fix", () => {
    expect(topFixable([found({ fixedVersion: "" })], 10)).toEqual([]);
  });
});
