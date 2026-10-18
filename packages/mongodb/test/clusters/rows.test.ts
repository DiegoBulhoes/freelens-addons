import { describe, expect, it } from "vitest";

import {
  agentTargetsOf,
  attentionItems,
  countsOf,
  describeHeadline,
  memberPodsOf,
  replicaSetRows,
} from "../../src/renderer/api/clusters/rows";
import { inventory, named, pods, replicaSets } from "../support/fixtures";

describe("the cluster list", () => {
  it("puts the sets that are down or failed first, then the degraded, then the healthy ones, each by name", () => {
    const rows = replicaSetRows(inventory());

    expect(rows.map((row) => [row.rs.getName(), row.health.tone])).toEqual([
      ["legacy-rs", "critical"],
      ["reporting-rs", "critical"],
      ["ledger-rs", "warning"],
      ["upgrade-rs", "warning"],
      ["catalog-rs", "ok"],
      ["orders-rs", "ok"],
      ["secure-rs", "ok"],
      ["sessions-rs", "ok"],
    ]);
  });

  it("takes only the pods of a cluster, arbiters included", () => {
    const names = memberPodsOf(replicaSets(), pods()).map((pod) => pod.getName());

    expect(names).toContain("sessions-rs-arb-0");
    expect(names.some((name) => name.startsWith("mongodb-kubernetes-operator"))).toBe(false);
  });
});

describe("whose agents a write reads", () => {
  it("reads only the set's own started pods, never another set's that share its prefix", () => {
    const ledger = named(replicaSets(), "ledger-rs");
    // A set named "ledger" would claim ledger-rs-0 through a "ledger-" prefix.
    const prefixOfAnother = { ...ledger, getName: () => "ledger", getNs: () => ledger.getNs() };

    expect(agentTargetsOf([ledger], pods())).toEqual([
      "mongodb/ledger-rs-0",
      "mongodb/ledger-rs-1",
    ]);
    expect(agentTargetsOf([prefixOfAnother], pods())).toEqual([]);
    expect(agentTargetsOf([named(replicaSets(), "sessions-rs")], pods())).toEqual([
      "mongodb/sessions-rs-0",
      "mongodb/sessions-rs-1",
      "mongodb/sessions-rs-arb-0",
    ]);
  });
});

describe("what needs attention", () => {
  it("lists every set that is not healthy, and no healthy one", () => {
    const items = attentionItems(replicaSetRows(inventory()));
    const sets = items.filter((item) => item.kind === "Cluster").map((item) => item.name);

    expect(sets).toEqual(
      expect.arrayContaining(["legacy-rs", "reporting-rs", "ledger-rs", "upgrade-rs"]),
    );
    expect(sets).not.toContain("catalog-rs");
  });

  it("counts no cluster while its pods are still being read, but one whose pods were refused", () => {
    const reading = replicaSetRows({ ...inventory(), podsRead: "reading" });
    const clusters = attentionItems(reading).filter((item) => item.kind === "Cluster");
    const needing = new Set(clusters.map((item) => item.replicaSet)).size;

    expect(clusters.map((item) => item.verdict.label)).not.toContain("Members unknown");
    // reporting-rs failed by the operator's word, which needs no pods.
    expect(clusters.map((item) => item.name)).toEqual(["reporting-rs"]);
    expect(describeHeadline(needing, reading.length, "connecting")).toBe(
      `1 of ${reading.length} clusters needs attention`,
    );

    const refused = attentionItems(replicaSetRows({ ...inventory(), podsRead: "refused" }));

    expect(
      refused.filter((item) => item.verdict.label === "Members unknown").map((item) => item.name),
    ).toEqual(expect.arrayContaining(["catalog-rs", "sessions-rs"]));
  });

  it("does not repeat a missing password Secret the operator's failure already names", () => {
    const items = attentionItems(replicaSetRows(inventory()));

    expect(items.filter((item) => item.kind === "User")).toEqual([]);
  });

  it("lists a user whose password Secret is missing when nothing else says so", () => {
    const rows = replicaSetRows(inventory()).map((row) =>
      row.rs.getName() === "reporting-rs"
        ? {
            ...row,
            rs: {
              ...row.rs,
              getName: () => "reporting-rs",
              getNs: () => "mongodb",
              status: { phase: "Pending" },
            },
          }
        : row,
    );
    const user = attentionItems(rows).find((item) => item.kind === "User");

    expect(user).toMatchObject({
      name: "reporting",
      replicaSet: "reporting-rs",
      verdict: { label: "No password" },
    });
  });

  it("counts by state and headlines the share needing attention", () => {
    const counts = countsOf(replicaSetRows(inventory()));

    expect(counts.replicaSets).toBe(replicaSets().length);
    expect(counts.critical).toBeGreaterThan(0);
    expect(counts["no-password"]).toBe(1);
    // upgrade-rs only: legacy-rs and reporting-rs never ran, so they change nothing.
    expect(counts["changing-version"]).toBe(1);
    expect(describeHeadline(0, 0, "ready")).toBe("No MongoDB clusters");
    expect(describeHeadline(0, 1, "ready")).toBe("1 cluster, all healthy");
    expect(describeHeadline(1, 5, "ready")).toBe("1 of 5 clusters needs attention");
    expect(describeHeadline(2, 5, "ready")).toBe("2 of 5 clusters need attention");
  });
});
