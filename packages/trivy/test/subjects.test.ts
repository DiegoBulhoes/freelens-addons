import { describe, expect, it } from "vitest";

import { subjectFromLabels, subjectKey, subjectOf } from "../src/renderer/api/subjects";
import { configAuditReports, sbomReports, vulnerabilityReports } from "./fixtures";

/**
 * Every join this extension makes runs through here. A subject read wrongly
 * does not throw — it silently fails to match, and a workload that was scanned
 * is then reported as unscanned, which is the one thing the extension must not
 * get wrong.
 */

const LABELS = [
  "trivy-operator.resource.namespace=argocd",
  "trivy-operator.resource.kind=ReplicaSet",
  "trivy-operator.resource.name=argocd-server-6d5f4c",
];

describe("reading the subject a report is about", () => {
  it("reads it from the operator's labels", () => {
    expect(subjectFromLabels(LABELS)).toEqual({
      namespace: "argocd",
      kind: "ReplicaSet",
      name: "argocd-server-6d5f4c",
    });
  });

  it("finds a subject on every report the cluster produced", () => {
    const reports = [...vulnerabilityReports(), ...sbomReports(), ...configAuditReports()];

    expect(reports.length).toBeGreaterThan(100);

    const without = reports.filter((report) => subjectOf(report) === undefined);

    expect(without.map((report) => report.getName())).toEqual([]);
  });

  it("produces keys that join across report kinds", () => {
    const keysOf = (reports: { getLabels(): string[]; getOwnerRefs(): { name: string }[] }[]) =>
      new Set(
        reports
          .map(subjectOf)
          .filter((subject) => subject !== undefined)
          .map(subjectKey),
      );

    const sbomKeys = keysOf(sbomReports());
    const auditKeys = keysOf(configAuditReports());
    const shared = [...sbomKeys].filter((key) => auditKeys.has(key));

    // The join is what the coverage numbers rest on, so it has to actually
    // match: most of what has an SBOM also has a config audit.
    expect(shared.length).toBeGreaterThan(sbomKeys.size / 2);
  });

  it("leaves some subjects in one kind and not the other, which is why coverage unions them", () => {
    const keysOf = (reports: { getLabels(): string[]; getOwnerRefs(): { name: string }[] }[]) =>
      new Set(
        reports
          .map(subjectOf)
          .filter((subject) => subject !== undefined)
          .map(subjectKey),
      );

    const onlyInSbom = [...keysOf(sbomReports())].filter(
      (key) => !keysOf(configAuditReports()).has(key),
    );

    // Real cluster contents: a ReplicaSet scaled away keeps its SBOM after its
    // config audit is collected. Taking one report kind as the list of known
    // workloads would silently drop these, so getCoverage unions every kind.
    expect(onlyInSbom.length).toBeGreaterThan(0);
  });
});

describe("reading a subject that is not there", () => {
  it("refuses a report missing any one of the three labels", () => {
    for (let index = 0; index < LABELS.length; index += 1) {
      const incomplete = LABELS.filter((_, position) => position !== index);

      expect(subjectFromLabels(incomplete)).toBeUndefined();
    }
  });

  it("refuses an empty label set rather than inventing a subject", () => {
    expect(subjectFromLabels([])).toBeUndefined();
  });

  it("refuses a label present but empty", () => {
    const blanked = LABELS.map((label) =>
      label.startsWith("trivy-operator.resource.name=") ? "trivy-operator.resource.name=" : label,
    );

    expect(subjectFromLabels(blanked)).toBeUndefined();
  });
});

describe("reading labels nobody would write on purpose", () => {
  it("ignores a label with no separator at all", () => {
    expect(subjectFromLabels([...LABELS, "a-label-with-no-equals"])).toBeDefined();
  });

  it("keeps an '=' inside a value rather than truncating at it", () => {
    const subject = subjectFromLabels([
      "trivy-operator.resource.namespace=argocd",
      "trivy-operator.resource.kind=ReplicaSet",
      "trivy-operator.resource.name=odd=name",
    ]);

    expect(subject?.name).toBe("odd=name");
  });

  it("ignores a label that begins with '=' rather than keying on an empty name", () => {
    expect(subjectFromLabels(["=orphan", ...LABELS])).toEqual({
      namespace: "argocd",
      kind: "ReplicaSet",
      name: "argocd-server-6d5f4c",
    });
  });

  it("builds a key that distinguishes two workloads differing only in kind", () => {
    const asReplicaSet = subjectKey({ namespace: "a", kind: "ReplicaSet", name: "web" });
    const asStatefulSet = subjectKey({ namespace: "a", kind: "StatefulSet", name: "web" });

    expect(asReplicaSet).not.toBe(asStatefulSet);
  });
});
