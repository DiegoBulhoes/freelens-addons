import { describe, expect, it } from "vitest";
import { crdKindOf, kindOf } from "../../src/renderer/api/objects/nodes";
import {
  attentionOf,
  bulkRestartRefusal,
  countsOf,
  describeHeadline,
  FILTER_LABELS,
  FILTER_TITLES,
  filterOf,
  filtersFor,
  keyOf,
  matchesFilter,
  namedKey,
  needsAttention,
  type RedisRow,
  redisRows,
  unreadRefusal,
} from "../../src/renderer/api/objects/rows";
import { HOST_LIST_TITLES, hostListOf } from "../../src/renderer/api/shared/host-links";
import { EVERYWHERE } from "../../src/renderer/api/shared/store-state";
import { inventory, NOW, named, objects, pods, variantOf } from "../support/fixtures";

const names = (rows: RedisRow[]) => rows.map((row) => row.object.getName());

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
    const rows = redisRows(inventory());
    const healthy = rows.filter((row) => row.health.tone === "ok");

    expect(describeHeadline([], "ready")).toBe("No Redis");
    expect(describeHeadline(healthy.slice(0, 1), "ready")).toBe("1 Redis object, all healthy");
    expect(describeHeadline(rows.slice(0, 1), "ready")).toBe("1 of 1 Redis object needs attention");
    expect(describeHeadline(rows, "ready")).toBe("2 of 6 Redis objects need attention");
  });

  it("says none only once the lists are read", () => {
    expect(describeHeadline([], "connecting")).toBe("Redis");
    expect(describeHeadline([], "unreachable")).toBe("Redis");
  });

  it("calls nothing down before its pods are read for this scope", () => {
    const unread = redisRows({ ...inventory(), pods: [], pvcs: [], podsRead: false });
    const read = redisRows({ ...inventory(), pods: [], pvcs: [], podsRead: true });

    expect(unread.map((row) => [row.health.tone, row.health.label])).toEqual(
      unread.map(() => ["info", "Unknown"]),
    );
    expect(unread.filter(needsAttention)).toEqual([]);
    expect(countsOf(unread)).toMatchObject({ down: 0, degraded: 0 });
    expect(describeHeadline(unread, "connecting")).toBe("6 Redis objects, pods not read yet");
    expect(read.filter((row) => row.health.label === "Down").length).toBeGreaterThan(0);
  });

  it("judges no row in a namespace whose pods were refused, and every other", () => {
    const refused = (failed: string[]) =>
      redisRows({ ...inventory(), podsFailed: new Set(failed) });
    const judged = redisRows(inventory()).map((row) => row.health);

    expect(refused(["redis"]).map((row) => [row.health.label, row.health.reason])).toEqual(
      judged.map(() => ["Unknown", "Its pods could not be read."]),
    );
    expect(refused([EVERYWHERE]).every((row) => row.health.label === "Unknown")).toBe(true);
    expect(redisRows(inventory()).map((row) => row.health)).toEqual(judged);
    expect(refused(["elsewhere"]).map((row) => row.health)).toEqual(judged);
    expect(refused(["redis"]).filter(needsAttention)).toEqual([]);
    expect(describeHeadline(refused(["redis"]), "ready")).toBe(
      "6 Redis objects, pods could not all be read",
    );
  });

  it("refuses a restart on pods not read, for that reason and not for a pod not ready", () => {
    const of = (rows: RedisRow[], name: string) =>
      rows.find((row) => row.object.getName() === name) as RedisRow;
    const unread = redisRows({ ...inventory(), pods: [], pvcs: [], podsRead: false });
    const refused = redisRows({ ...inventory(), podsFailed: new Set(["redis"]) });
    const read = redisRows(inventory());

    expect(bulkRestartRefusal(of(unread, "cache"))).toBe("Its pods have not been read yet.");
    expect(unreadRefusal(of(unread, "cache"))).toBe("Its pods have not been read yet.");
    expect(bulkRestartRefusal(of(refused, "cache"))).toBe("Its pods could not be read.");
    expect(unreadRefusal(of(read, "cache"))).toBeUndefined();
    expect(bulkRestartRefusal(of(read, "cache"))).toBeUndefined();
    expect(bulkRestartRefusal(of(read, "broken-cache"))).toMatch(/not ready/);
  });

  it("lists what needs attention, the healthy left out", () => {
    expect(
      redisRows(inventory())
        .filter(needsAttention)
        .map((row) => row.object.getName()),
    ).toEqual(["broken-cache", "legacy-store"]);
  });

  it("keys rows by kind, namespace and name", () => {
    expect(keyOf(named("cache"))).toBe("RedisReplication/redis/cache");
  });
});

// The fixture's cluster, its operator stuck in Bootstrap: the real state seen after a pod moved IP.
const stuckShards = () => variantOf(named("shards"), { status: { state: "Bootstrap" } });

describe("filters and cards", () => {
  const withStuck = () => ({
    ...inventory(),
    objects: inventory().objects.map((each) =>
      each.getName() === "shards" ? stuckShards() : each,
    ),
  });

  it("calls a cluster stuck by the time it is given", () => {
    const cluster = redisRows(withStuck(), NOW).find((row) => row.kind === "Cluster");

    expect(cluster?.health).toMatchObject({ tone: "warning", label: "Stuck in Bootstrap" });
  });

  it("keeps what each filter names, and a card counts what its filter keeps", () => {
    const rows = redisRows(withStuck(), NOW);
    const counts = countsOf(rows);

    expect(names(rows.filter((row) => matchesFilter(row, "down")))).toEqual([
      "broken-cache",
      "legacy-store",
    ]);
    expect(names(rows.filter((row) => matchesFilter(row, "degraded")))).toEqual(["shards"]);
    expect(names(rows.filter((row) => matchesFilter(row, "unwatched")))).toEqual(["broken-cache"]);
    expect(rows.filter((row) => matchesFilter(row, "all"))).toHaveLength(rows.length);
    expect([counts.down, counts.degraded, counts.unwatched]).toEqual([2, 1, 1]);
  });

  it("narrows Needs attention to the card's filter, across every kind", () => {
    const rows = redisRows(withStuck(), NOW);

    expect(names(attentionOf(rows, "all"))).toEqual(["broken-cache", "legacy-store", "shards"]);
    expect(attentionOf(rows, "down").map((row) => row.kind)).toEqual(["Replication", "Standalone"]);
    expect(names(attentionOf(rows, "degraded"))).toEqual(["shards"]);
  });

  it("offers No sentinel on replications only, and reads a filter from the route", () => {
    expect(filtersFor("Replication")).toEqual(["all", "down", "degraded", "unwatched"]);
    expect(filtersFor("Cluster")).toEqual(["all", "down", "degraded"]);
    expect(filterOf("Replication", "unwatched")).toBe("unwatched");
    expect(filterOf("Sentinel", "unwatched")).toBe("all");
    expect(filterOf("Cluster", "degraded")).toBe("degraded");
    expect(filterOf("Cluster", undefined)).toBe("all");
    expect(Object.keys(FILTER_LABELS)).toEqual(Object.keys(FILTER_TITLES));
  });
});

describe("opening one row from elsewhere", () => {
  it("keys the row a route names, so its drawer opens", () => {
    for (const object of objects()) {
      expect(
        namedKey(kindOf(object), { namespace: object.getNs(), name: object.getName() }),
        object.getName(),
      ).toBe(keyOf(object));
    }
    expect(namedKey("Standalone", { namespace: "redis" })).toBeUndefined();
    expect(namedKey("Standalone", { name: "sessions" })).toBe("Redis//sessions");
    expect(crdKindOf("Sentinel")).toBe("RedisSentinel");
  });

  it("links a pod, a claim and a Secret to the host's lists, searched by name", () => {
    expect(hostListOf("Pod", "cache-1")).toBe("/pods?search=cache-1");
    expect(hostListOf("Pod", "a b")).toBe("/pods?search=a%20b");
    expect(hostListOf("PersistentVolumeClaim", "cache-cache-0")).toBe(
      "/persistent-volume-claims?search=cache-cache-0",
    );
    expect(hostListOf("Secret", "redis-password")).toBe("/secrets?search=redis-password");

    const node = pods()[0]?.spec?.nodeName ?? "";

    expect(node).not.toBe("");
    expect(hostListOf("Node", node)).toBe(`/nodes?search=${encodeURIComponent(node)}`);
    expect(HOST_LIST_TITLES.Node).toBe("Opens the host's Nodes list, searched by this name");
    expect(HOST_LIST_TITLES.Pod).toBe("Opens the host's Pods list, searched by this name");
  });
});
