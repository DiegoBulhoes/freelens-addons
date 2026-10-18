import { describe, expect, it } from "vitest";

import { healthOf, STUCK_AFTER_MS } from "../../src/renderer/api/objects/health";
import { nodesOf } from "../../src/renderer/api/objects/nodes";
import type { PodLike, RedisLike } from "../../src/renderer/api/shared/types";
import { NOW, named, pods, pvcs, variantOf } from "../support/fixtures";

const health = (object: RedisLike, watchedExists?: boolean) =>
  healthOf(
    object,
    nodesOf(object, pods(), pvcs()),
    watchedExists === undefined ? {} : { watchedExists },
  );

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

    expect(health(variantOf(cache, { spec: { ...cache.spec, clusterSize: 4 } }))).toMatchObject({
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
      health(variantOf(cache, { status: { ...cache.status, masterNode: "cache-9" } })),
    ).toMatchObject({
      tone: "info",
      label: "Changing master",
    });
  });

  it("passes on a cluster's failed or unfinished state with the operator's reason", () => {
    const shards = named("shards");

    expect(
      health(variantOf(shards, { status: { state: "Failed", reason: "slots uncovered" } })),
    ).toMatchObject({
      label: "Failed",
      reason: "slots uncovered",
    });
    expect(health(variantOf(shards, { status: { state: "Bootstrap" } }))).toMatchObject({
      tone: "info",
      label: "Bootstrap",
    });
    expect(health(variantOf(shards, { status: { state: "Failed" } })).reason).toBe(
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

describe("a cluster the operator never finishes", () => {
  const shards = named("shards");
  const bootstrap = variantOf(shards, { status: { state: "Bootstrap" } });
  const nodes = nodesOf(bootstrap, pods(), pvcs());
  const youngest = Math.max(...nodes.map((each) => Date.parse(each.upSince ?? "")));

  it("is stuck once every pod has been up long enough, naming the youngest", () => {
    expect(healthOf(bootstrap, nodes, { now: youngest + STUCK_AFTER_MS })).toMatchObject({
      tone: "warning",
      label: "Stuck in Bootstrap",
      reason: expect.stringMatching(/up 10m or more \(the youngest is shards-follower-2\)/),
    });
    expect(healthOf(bootstrap, nodes, { now: NOW }).label).toBe("Stuck in Bootstrap");
  });

  it("is still working while a pod is younger, or has no start time", () => {
    expect(healthOf(bootstrap, nodes, { now: youngest + STUCK_AFTER_MS - 1 })).toMatchObject({
      tone: "info",
      label: "Bootstrap",
    });

    const unstarted = nodes.map((each, at) => (at === 0 ? { ...each, upSince: undefined } : each));

    expect(healthOf(bootstrap, unstarted, { now: NOW }).label).toBe("Bootstrap");
    expect(healthOf(shards, nodes, { now: NOW }).label).toBe("Healthy");
  });

  it("leaves a pod from a scale-down out when it names the youngest", () => {
    const scaled = variantOf(shards, {
      spec: { ...shards.spec, clusterSize: 2 },
      status: { state: "Bootstrap" },
    });
    const list = nodesOf(scaled, pods(), pvcs());
    const since = Date.parse(list.find((each) => each.name === "shards-leader-1")?.upSince ?? "");

    expect(list.filter((each) => each.extra).map((each) => each.name)).toEqual([
      "shards-leader-2",
      "shards-follower-2",
    ]);
    expect(healthOf(scaled, list, { now: since + STUCK_AFTER_MS })).toMatchObject({
      label: "Stuck in Bootstrap",
      reason: expect.stringContaining("(the youngest is shards-leader-1)"),
    });
  });
});

// A real cache pod, not ready, and with or without the operator's master label.
function downPod(name: string, labelled: boolean): PodLike {
  const pod = pods().find((each) => each.getName() === name) as PodLike;
  const labels = Object.fromEntries(
    Object.entries(pod.metadata.labels ?? {}).filter(([key]) => labelled || key !== "redis-role"),
  );

  return {
    ...pod,
    getName: () => pod.getName(),
    getNs: () => pod.getNs(),
    metadata: { ...pod.metadata, labels },
    status: {
      ...pod.status,
      conditions: [{ type: "Ready", status: "False" }],
      containerStatuses: [
        {
          name: "cache",
          ready: false,
          restartCount: 1,
          lastState: { terminated: { reason: "Error", exitCode: 1 } },
        },
      ],
    },
  };
}

describe("a replication whose master is not up", () => {
  const cache = named("cache");
  const master = cache.status?.masterNode ?? "";
  const withPod = (pod: PodLike) =>
    nodesOf(
      cache,
      pods().map((each) => (each.getName() === master ? pod : each)),
      pvcs(),
    );

  it("is critical while its labelled master is not ready, though its replicas are", () => {
    expect(healthOf(cache, withPod(downPod(master, true)))).toEqual({
      tone: "critical",
      label: "Master down",
      reason: `${master} is master and not ready: writes are refused. cache last exited: Error (code 1)`,
    });

    const quiet = withPod(downPod(master, true)).map((each) => ({ ...each, problem: undefined }));

    expect(healthOf(cache, quiet).reason).toBe(
      `${master} is master and not ready: writes are refused.`,
    );
  });

  it("is critical while the master's new pod waits for its label", () => {
    expect(healthOf(cache, withPod(downPod(master, false)))).toEqual({
      tone: "critical",
      label: "No master",
      reason: "2 of 3 pods ready, and none is master: writes are refused.",
    });
  });
});
