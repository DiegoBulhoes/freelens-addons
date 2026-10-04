import { describe, expect, it } from "vitest";

import {
  attentionItems,
  countsOf,
  describeHeadline,
  memberPodsOf,
  replicaSetRows,
} from "../src/renderer/api/rows";
import { inventory, pods, replicaSets } from "./fixtures";

describe("the cluster list", () => {
  it("puts the sets that are down or failed first, then the healthy ones, each by name", () => {
    const rows = replicaSetRows(inventory());

    expect(rows.map((row) => [row.rs.getName(), row.health.tone])).toEqual([
      ["legacy-rs", "critical"],
      ["reporting-rs", "critical"],
      ["upgrade-rs", "critical"],
      ["catalog-rs", "ok"],
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

describe("what needs attention", () => {
  it("lists every set that is not healthy, and no healthy one", () => {
    const items = attentionItems(replicaSetRows(inventory()));
    const sets = items.filter((item) => item.kind === "Cluster").map((item) => item.name);

    expect(sets).toEqual(expect.arrayContaining(["legacy-rs", "reporting-rs", "upgrade-rs"]));
    expect(sets).not.toContain("catalog-rs");
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
    expect(counts.down).toBeGreaterThan(0);
    expect(counts.usersWithoutPassword).toBe(1);
    expect(describeHeadline(0, 0)).toBe("No MongoDB clusters");
    expect(describeHeadline(0, 1)).toBe("1 cluster, all healthy");
    expect(describeHeadline(1, 5)).toBe("1 of 5 clusters needs attention");
    expect(describeHeadline(2, 5)).toBe("2 of 5 clusters need attention");
  });
});
