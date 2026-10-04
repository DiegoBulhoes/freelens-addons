import { describe, expect, it } from "vitest";

import { countsOf, describeHeadline, keyOf, redisRows } from "../src/renderer/api/rows";
import { inventory, named } from "./fixtures";

describe("the rows", () => {
  it("puts what is down first, then the healthy, each by name", () => {
    expect(redisRows(inventory()).map((row) => [row.object.getName(), row.health.tone])).toEqual([
      ["broken-cache", "critical"],
      ["legacy-store", "critical"],
      ["cache", "ok"],
      ["cache-sentinel", "ok"],
      ["sessions", "ok"],
      ["shards", "ok"],
    ]);
  });

  it("links a replication to its sentinels and a sentinel to its replication", () => {
    const rows = redisRows(inventory());
    const of = (name: string) => rows.find((row) => row.object.getName() === name);

    expect(of("cache")?.related.map((each) => each.getName())).toEqual(["cache-sentinel"]);
    expect(of("cache-sentinel")?.related.map((each) => each.getName())).toEqual(["cache"]);
    expect(of("broken-cache")?.related).toEqual([]);
    expect(of("shards")?.related).toEqual([]);
  });

  it("says a sentinel watches nothing when its replication is gone", () => {
    const rows = redisRows({
      ...inventory(),
      objects: inventory().objects.filter((each) => each.getName() !== "cache"),
    });

    expect(rows.find((row) => row.object.getName() === "cache-sentinel")?.health.label).toBe(
      "Watches nothing",
    );
  });

  it("counts by kind and state, and replications no sentinel watches", () => {
    expect(countsOf(redisRows(inventory()))).toEqual({
      total: 6,
      down: 2,
      degraded: 0,
      replications: 2,
      clusters: 1,
      standalones: 2,
      sentinels: 1,
      unwatched: 1,
    });
  });

  it("headlines the share needing attention", () => {
    expect(describeHeadline(0, 0)).toBe("No Redis");
    expect(describeHeadline(0, 1)).toBe("1 Redis object, all healthy");
    expect(describeHeadline(1, 1)).toBe("1 of 1 Redis object needs attention");
    expect(describeHeadline(2, 6)).toBe("2 of 6 Redis objects need attention");
  });

  it("keys rows by kind, namespace and name", () => {
    expect(keyOf(named("cache"))).toBe("RedisReplication/redis/cache");
  });
});
