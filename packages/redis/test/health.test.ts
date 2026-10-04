import { describe, expect, it } from "vitest";

import { healthOf } from "../src/renderer/api/health";
import { nodesOf } from "../src/renderer/api/nodes";
import type { RedisLike } from "../src/renderer/api/types";
import { named, pods, pvcs } from "./fixtures";

const health = (object: RedisLike, watchedExists?: boolean) =>
  healthOf(
    object,
    nodesOf(object, pods(), pvcs()),
    watchedExists === undefined ? {} : { watchedExists },
  );

function variant(
  object: RedisLike,
  change: Partial<Pick<RedisLike, "spec" | "status">>,
): RedisLike {
  return {
    ...object,
    kind: object.kind,
    getName: () => object.getName(),
    getNs: () => object.getNs(),
    spec: change.spec ?? object.spec,
    status: "status" in change ? change.status : object.status,
  };
}

describe("judging each kind", () => {
  it("calls the running ones healthy", () => {
    for (const name of ["cache", "shards", "sessions", "cache-sentinel"]) {
      expect(health(named(name), true).label, name).toBe("Healthy");
    }
  });

  it("names the concrete cause of one that is down", () => {
    expect(health(named("legacy-store"))).toMatchObject({
      tone: "critical",
      label: "Down",
      reason: expect.stringMatching(/not bound/),
    });
    expect(health(named("broken-cache")).reason).toMatch(/v9\.9\.999/);
  });

  it("calls a replication missing a pod degraded", () => {
    const cache = named("cache");

    expect(health(variant(cache, { spec: { ...cache.spec, clusterSize: 4 } }))).toMatchObject({
      tone: "warning",
      label: "Degraded",
      reason: "3 of 4 pods ready. It has no pod yet.",
    });
  });

  it("calls a replication whose pods name no master critical", () => {
    const cache = named("cache");
    const nodes = nodesOf(cache, pods(), pvcs()).map((each) => ({
      ...each,
      role: "replica" as const,
    }));

    expect(healthOf(cache, nodes).label).toBe("No master");
  });

  it("says the master is changing while the operator and the labels disagree", () => {
    const cache = named("cache");

    expect(
      health(variant(cache, { status: { ...cache.status, masterNode: "cache-9" } })),
    ).toMatchObject({
      tone: "info",
      label: "Changing master",
    });
  });

  it("passes on a cluster's failed or unfinished state with the operator's reason", () => {
    const shards = named("shards");

    expect(
      health(variant(shards, { status: { state: "Failed", reason: "slots uncovered" } })),
    ).toMatchObject({
      label: "Failed",
      reason: "slots uncovered",
    });
    expect(health(variant(shards, { status: { state: "Bootstrap" } }))).toMatchObject({
      tone: "info",
      label: "Bootstrap",
    });
    expect(health(variant(shards, { status: { state: "Failed" } })).reason).toBe(
      "The operator gave up on it.",
    );
  });

  it("says a sentinel watches nothing, or is below quorum", () => {
    const sentinel = named("cache-sentinel");

    expect(health(sentinel, false).label).toBe("Watches nothing");

    const fewer = nodesOf(sentinel, pods(), pvcs()).map((each, at) =>
      at > 0 ? { ...each, ready: false } : each,
    );

    expect(healthOf(sentinel, fewer, { watchedExists: true })).toMatchObject({
      tone: "critical",
      label: "Below quorum",
    });
  });
});
