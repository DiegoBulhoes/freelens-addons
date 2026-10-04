import { describe, expect, it } from "vitest";

import { masterOf, nodesOf, type RedisNode } from "../src/renderer/api/nodes";
import {
  CLUSTER_RESTART_REFUSAL,
  commandsOf,
  describeStep,
  failoverCommand,
  failoverRefusal,
  isSettled,
  memberRestartRefusal,
  redisCliCommand,
  restartAllPlan,
  scalePatch,
  scaleRefusal,
  scaleWarnings,
  sentinelsOf,
  stepRefusal,
} from "../src/renderer/api/operations";
import type { RedisLike } from "../src/renderer/api/types";
import { named, objects, pods, pvcs } from "./fixtures";

const nodes = (object: RedisLike): RedisNode[] => nodesOf(object, pods(), pvcs());

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

describe("scaling", () => {
  it("refuses a standalone, a bad count, a cluster under three leaders, and no change", () => {
    expect(scaleRefusal(named("sessions"), 2)).toMatch(/nothing to scale/);
    expect(scaleRefusal(named("cache"), 0)).toMatch(/at least one/);
    expect(scaleRefusal(named("cache"), 1.5)).toMatch(/at least one/);
    expect(scaleRefusal(named("shards"), 2)).toMatch(/at least 3 leaders/);
    expect(scaleRefusal(named("cache"), 51)).toMatch(/At most 50/);
    expect(scaleRefusal(named("cache"), 3)).toMatch(/already has 3/);
    expect(scaleRefusal(named("cache"), 5)).toBeUndefined();
  });

  it("warns of what goes, of resharding, of an even or short sentinel quorum, and of a lone pod", () => {
    expect(scaleWarnings(named("cache"), 1)).toEqual([
      "Removes cache-1, cache-2; volumes are kept.",
      "With one pod there is no replica to fail over to.",
    ]);
    expect(scaleWarnings(named("shards"), 4)).toEqual([
      "The operator moves hash slots between leaders; that takes a while and loads the cluster.",
    ]);
    expect(scaleWarnings(named("shards"), 3).length).toBe(1);
    expect(
      scaleWarnings(
        variant(named("shards"), { spec: { ...named("shards").spec, clusterSize: 4 } }),
        3,
      )[0],
    ).toMatch(/Removes shards-leader-3 and their followers/);
    expect(scaleWarnings(named("cache-sentinel"), 2)).toEqual([
      "Removes cache-sentinel-sentinel-2; volumes are kept.",
      "2 sentinels can split evenly; an odd number avoids it.",
    ]);
    expect(scaleWarnings(named("cache-sentinel"), 1)).toContain(
      "Its quorum is 2: with 1 sentinels no failover can be agreed.",
    );
  });

  it("sets the size, and the leader and follower counts when the cluster names them", () => {
    expect(scalePatch(named("cache"), 4)).toEqual({ spec: { clusterSize: 4 } });

    const pinned = variant(named("shards"), {
      spec: {
        ...named("shards").spec,
        redisLeader: { replicas: 3 },
        redisFollower: { replicas: 3 },
      },
    });

    expect(scalePatch(pinned, 4)).toEqual({
      spec: { clusterSize: 4, redisLeader: { replicas: 4 }, redisFollower: { replicas: 4 } },
    });
  });
});

describe("restarting", () => {
  it("plans a replication's replicas first and its master last", () => {
    const cache = named("cache");
    const plan = restartAllPlan(cache, nodes(cache));
    const master = masterOf(nodes(cache))?.name;

    expect("steps" in plan && plan.steps.at(-1)).toEqual({ node: master, last: true });
    expect("steps" in plan && plan.steps.map(describeStep).at(-1)).toBe(`restart ${master}`);
    expect("steps" in plan && plan.steps.filter((each) => !each.last)).toHaveLength(2);
  });

  it("refuses to restart a cluster's pods, which the operator does not rejoin", () => {
    expect(restartAllPlan(named("shards"), nodes(named("shards")))).toEqual({
      refused: CLUSTER_RESTART_REFUSAL,
    });
    expect(memberRestartRefusal(named("shards"), nodes(named("shards")), "shards-follower-0")).toBe(
      CLUSTER_RESTART_REFUSAL,
    );
  });

  it("refuses when a pod is down, or a replication's master cannot be told", () => {
    expect(restartAllPlan(named("broken-cache"), nodes(named("broken-cache")))).toEqual({
      refused:
        "broken-cache-0, broken-cache-1 are not ready; restarting the others could leave no copy.",
    });
    expect(restartAllPlan(named("legacy-store"), nodes(named("legacy-store")))).toMatchObject({
      refused: expect.stringMatching(/is not ready/),
    });

    const unlabelled = nodes(named("cache")).map((each) => ({ ...each, role: "replica" as const }));

    expect(restartAllPlan(named("cache"), unlabelled)).toMatchObject({
      refused: expect.stringMatching(/master could not be told/),
    });
  });

  it("re-checks each step against fresh pods", () => {
    const cache = named("cache");
    const list = nodes(cache);
    const master = masterOf(list)?.name ?? "";
    const replica = list.find((each) => each.role === "replica")?.name ?? "";

    expect(stepRefusal(cache, { node: replica, last: false }, list)).toBeUndefined();
    expect(stepRefusal(cache, { node: master, last: true }, list)).toBeUndefined();
    expect(stepRefusal(cache, { node: master, last: false }, list)).toMatch(/became the master/);
    expect(stepRefusal(cache, { node: "cache-9", last: false }, list)).toMatch(/has no pod/);
    expect(
      stepRefusal(
        cache,
        { node: replica, last: false },
        list.map((each) => (each.name === master ? { ...each, ready: false } : each)),
      ),
    ).toMatch(/Another pod/);
  });

  it("calls a set settled when every pod is ready and the master agrees", () => {
    const cache = named("cache");

    expect(isSettled(cache, nodes(cache))).toBe(true);
    expect(
      isSettled(
        variant(cache, { status: { ...cache.status, masterNode: "cache-9" } }),
        nodes(cache),
      ),
    ).toBe(false);
    expect(
      isSettled(
        cache,
        nodes(cache).map((each) => (each.role === "replica" ? { ...each, role: undefined } : each)),
      ),
    ).toBe(false);
    expect(isSettled(named("legacy-store"), nodes(named("legacy-store")))).toBe(false);
    expect(isSettled(named("sessions"), nodes(named("sessions")))).toBe(true);
    expect(isSettled(cache, [])).toBe(false);
  });

  it("refuses to restart a pod while another is down, or one that has no pod", () => {
    const list = nodes(named("cache"));
    const [first, second] = list;

    expect(memberRestartRefusal(named("cache"), list, first?.name ?? "")).toBeUndefined();
    expect(
      memberRestartRefusal(
        named("cache"),
        list.map((each) => (each === second ? { ...each, ready: false } : each)),
        first?.name ?? "",
      ),
    ).toMatch(/Another pod is not ready/);
    expect(
      memberRestartRefusal(named("broken-cache"), nodes(named("broken-cache")), "broken-cache-1"),
    ).toMatch(/no pod/);
  });
});

describe("failing over", () => {
  const cache = named("cache");
  const sentinel = sentinelsOf(cache, objects())[0];

  it("finds the sentinels watching a replication", () => {
    expect(sentinel?.getName()).toBe("cache-sentinel");
    expect(sentinelsOf(named("broken-cache"), objects())).toEqual([]);
  });

  it("allows a replication with a ready sentinel, a master and a ready replica", () => {
    expect(
      failoverRefusal(cache, nodes(cache), sentinel, sentinel ? nodes(sentinel) : []),
    ).toBeUndefined();
  });

  it("refuses without a sentinel, ready sentinels, a master or a replica", () => {
    const sentinelNodes = sentinel ? nodes(sentinel) : [];

    expect(
      failoverRefusal(named("shards"), nodes(named("shards")), sentinel, sentinelNodes),
    ).toMatch(/Only a replication/);
    expect(failoverRefusal(cache, nodes(cache), undefined, [])).toMatch(/No sentinel watches it/);
    expect(
      failoverRefusal(
        cache,
        nodes(cache),
        sentinel,
        sentinelNodes.map((each) => ({ ...each, ready: false })),
      ),
    ).toMatch(/No pod of cache-sentinel is ready/);
    expect(
      failoverRefusal(
        cache,
        nodes(cache).map((each) => ({ ...each, role: "replica" as const })),
        sentinel,
        sentinelNodes,
      ),
    ).toMatch(/no master/);
    expect(
      failoverRefusal(
        cache,
        nodes(cache).map((each) => (each.role === "replica" ? { ...each, ready: false } : each)),
        sentinel,
        sentinelNodes,
      ),
    ).toMatch(/no ready replica/);
  });

  it("asks the sentinels by their master group, authenticating inside the pod", () => {
    expect(sentinel && failoverCommand(sentinel)).toEqual([
      "sh",
      "-c",
      'redis-cli -p 26379 --no-auth-warning -a "$REDIS_PASSWORD" SENTINEL failover myMaster',
    ]);
  });
});

describe("connecting", () => {
  it("opens redis-cli in the pod, with the password expanded there", () => {
    const [first] = nodes(named("cache"));

    expect(first && redisCliCommand(named("cache"), first)).toBe(
      `kubectl exec -it -n redis cache-0 -c cache -- sh -c 'exec redis-cli --no-auth-warning -a "$REDIS_PASSWORD"'`,
    );
  });

  it("adds cluster mode, the sentinel port and TLS where they apply", () => {
    const [leader] = nodes(named("shards"));
    const [sentinelPod] = nodes(named("cache-sentinel"));
    const [session] = nodes(named("sessions"));

    expect(leader && redisCliCommand(named("shards"), leader)).toContain(
      "exec redis-cli -c --no-auth-warning",
    );
    expect(sentinelPod && redisCliCommand(named("cache-sentinel"), sentinelPod)).toContain(
      "exec redis-cli -p 26379",
    );
    expect(session && redisCliCommand(named("sessions"), session)).toContain(
      '--tls --cacert "$REDIS_TLS_CA_CERT" --cert "$REDIS_TLS_CERT" --key "$REDIS_TLS_CERT_KEY"',
    );
  });

  it("leaves the password out when the object has none, and the container when unknown", () => {
    expect(
      redisCliCommand(named("legacy-store"), {
        name: "legacy-store-0",
        ready: false,
        restarts: 0,
        extra: false,
      }),
    ).toBe("kubectl exec -it -n redis legacy-store-0 -- sh -c 'exec redis-cli'");
  });

  it("offers commands, the password one only with a Secret", () => {
    expect(commandsOf(named("cache")).map((each) => each.label)).toContain(
      "The password, from its Secret",
    );
    expect(commandsOf(named("legacy-store")).map((each) => each.label)).not.toContain(
      "The password, from its Secret",
    );
    expect(commandsOf(named("shards"))[0]?.command).toBe(
      "kubectl describe rediscluster -n redis shards",
    );
  });
});
