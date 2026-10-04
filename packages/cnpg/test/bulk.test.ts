import { describe, expect, it } from "vitest";

import {
  clusterRefusal,
  describeOutcome,
  planFor,
  poolerRefusal,
  scheduleRefusal,
} from "../src/renderer/api/bulk";
import { clusters, poolers, schedules, variantOf } from "./fixtures";

const names = (items: { getName(): string }[]) => items.map((item) => item.getName()).sort();

describe("planning an action over a selection", () => {
  it("backs up the clusters that can be, and says why the others are skipped", () => {
    const plan = planFor(clusters(), clusterRefusal("backup"));

    expect(names(plan.ready)).toEqual(["billing-db", "orders-db"]);
    expect(plan.skipped.map(({ item, reason }) => [item.getName(), reason])).toEqual(
      expect.arrayContaining([
        ["inventory-db", "inventory-db has no backup method configured."],
        ["reports-db", "reports-db is hibernated. Wake it first."],
      ]),
    );
  });

  it("wakes only the hibernated, and hibernates only the others", () => {
    expect(names(planFor(clusters(), clusterRefusal("wake")).ready)).toEqual(["reports-db"]);
    expect(names(planFor(clusters(), clusterRefusal("hibernate")).ready)).not.toContain(
      "reports-db",
    );
  });

  it("suspends what runs and starts what is suspended", () => {
    const all = schedules();

    expect(names(planFor(all, scheduleRefusal("suspend", clusters())).ready)).toEqual([
      "billing-nightly",
      "orders-hourly",
    ]);
    expect(planFor(all, scheduleRefusal("start", clusters())).skipped[0]?.reason).toBe(
      "Already running.",
    );
    expect(names(planFor(all, scheduleRefusal("start", clusters())).ready)).toEqual([
      "orders-weekly",
    ]);
  });

  it("backs up from a schedule only when its cluster exists and is awake", () => {
    const orphan = variantOf(schedules()[0] as never, (raw) => {
      raw.spec.cluster.name = "gone-db";
    });
    const plan = planFor([...schedules(), orphan], scheduleRefusal("backup", clusters()));

    expect(plan.skipped.map(({ reason }) => reason)).toEqual([
      "No cluster named gone-db, so there is nothing to back up.",
    ]);
  });

  it("pauses what runs and starts what is paused", () => {
    const paused = variantOf(poolers()[0] as never, (raw) => {
      raw.spec.pgbouncer.paused = true;
    });
    const all = [...poolers(), paused];

    expect(planFor(all, poolerRefusal("pause")).skipped.map(({ reason }) => reason)).toEqual([
      "Already paused.",
    ]);
    expect(planFor(all, poolerRefusal("start")).ready).toEqual([paused]);
  });

  it("is empty for an empty selection", () => {
    expect(planFor([], clusterRefusal("reload"))).toEqual({ ready: [], skipped: [] });
  });
});

describe("reporting how it went", () => {
  it("counts what was done, and names what failed", () => {
    expect(describeOutcome("Deleted", 3, [])).toBe("Deleted 3 of 3.");
    expect(describeOutcome("Deleted", 2, ["a"])).toBe("Deleted 2 of 3. Failed: a.");
  });
});
