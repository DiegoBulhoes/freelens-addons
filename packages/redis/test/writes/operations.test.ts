import { describe, expect, it } from "vitest";

import { masterOf, nodesOf, type RedisNode } from "../../src/renderer/api/objects/nodes";
import { sentinelsOf } from "../../src/renderer/api/objects/rows";
import type { PodLike, RedisLike } from "../../src/renderer/api/shared/types";
import {
  BULK_RESTART_TOOLTIP,
  CLUSTER_RESTART_REFUSAL,
  commandsOf,
  describeRestartStart,
  describeStep,
  describeStepDone,
  failoverCommand,
  failoverRefusal,
  isSettled,
  nodeRestartRefusal,
  nodeRestartRefusalNow,
  podReplaced,
  redisCliCommand,
  replicasUnknownToSentinel,
  restartAllPlan,
  scaleAdvice,
  scalePatch,
  scaleRefusal,
  scaleWarnings,
  sentinelReplicasCommand,
  stepRefusal,
} from "../../src/renderer/api/writes/operations";
import { named, objects, pods, pvcs, variantOf } from "../support/fixtures";

const nodes = (object: RedisLike): RedisNode[] => nodesOf(object, pods(), pvcs());

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
        variantOf(named("shards"), { spec: { ...named("shards").spec, clusterSize: 4 } }),
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

  it("says what a size would do while it is typed, before anything is sent", () => {
    expect(scaleAdvice(named("cache"), "3")).toEqual({ warnings: [] });
    expect(scaleAdvice(named("sessions"), "1")).toEqual({ warnings: [] });
    expect(scaleAdvice(named("cache"), " 1 ")).toEqual({
      warnings: [
        "Removes cache-1, cache-2; volumes are kept.",
        "With one pod there is no replica to fail over to.",
      ],
    });
    expect(scaleAdvice(named("shards"), "2")).toEqual({
      refused: "A Redis cluster needs at least 3 leaders.",
      warnings: [],
    });
    expect(scaleAdvice(named("cache-sentinel"), "")).toEqual({
      refused: "It needs at least one pod.",
      warnings: [],
    });
  });

  it("sets the size, and the leader and follower counts when the cluster names them", () => {
    expect(scalePatch(named("cache"), 4)).toEqual({ spec: { clusterSize: 4 } });

    const pinned = variantOf(named("shards"), {
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
    expect(nodeRestartRefusal(named("shards"), nodes(named("shards")), "shards-follower-0")).toBe(
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

  it("refuses, and does not call settled, while a restarted replica is still labelled master", () => {
    const cache = named("cache");
    const list = nodes(cache);
    const replica = list.find((each) => each.role === "replica")?.name;
    const twoMasters = list.map((each) =>
      each.name === replica ? { ...each, role: "master" as const } : each,
    );

    expect(restartAllPlan(cache, twoMasters)).toMatchObject({
      refused: expect.stringMatching(/are each labelled master/),
    });
    expect(isSettled(cache, twoMasters)).toBe(false);
  });

  it("names the replicas a sentinel does not list as up, by their pods' IPs", () => {
    const cache = named("cache");
    const replicas = nodes(cache).filter((each) => each.role === "replica");
    const [first, second] = replicas.map((each) => each.pod?.status?.podIP ?? "");

    expect(replicasUnknownToSentinel(`${first} slave\n${second} slave\n`, replicas)).toEqual([]);
    expect(replicasUnknownToSentinel(`${first} slave\n`, replicas)).toEqual([replicas[1]?.name]);
    expect(
      replicasUnknownToSentinel(`${first} s_down,slave,disconnected\n${second} slave`, replicas),
    ).toEqual([replicas[0]?.name]);
    expect(replicasUnknownToSentinel("", replicas)).toEqual(replicas.map((each) => each.name));
    expect(sentinelReplicasCommand(named("cache-sentinel")).at(-1)).toMatch(
      /SENTINEL replicas myMaster \| awk/,
    );
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
        list.map((each) =>
          each.name === replica && each.pod
            ? { ...each, pod: { ...each.pod, metadata: { ...each.pod.metadata, uid: undefined } } }
            : each,
        ),
      ),
    ).toMatch(/has no pod/);
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
        variantOf(cache, { status: { ...cache.status, masterNode: "cache-9" } }),
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

    expect(nodeRestartRefusal(named("cache"), list, first?.name ?? "")).toBeUndefined();
    expect(
      nodeRestartRefusal(
        named("cache"),
        list.map((each) => (each === second ? { ...each, ready: false } : each)),
        first?.name ?? "",
      ),
    ).toMatch(/Another pod is not ready/);
    expect(
      nodeRestartRefusal(
        named("cache"),
        list
          .map((each) => (each === second ? { ...each, ready: false } : each))
          .map((each) => (each === first ? { ...each, ready: false } : each)),
        first?.name ?? "",
      ),
    ).toBeUndefined();
    expect(
      nodeRestartRefusal(named("broken-cache"), nodes(named("broken-cache")), "broken-cache-1"),
    ).toMatch(/no pod/);
  });

  it("restarts a stuck pod, though its sibling is not up either", () => {
    expect(
      nodeRestartRefusal(named("broken-cache"), nodes(named("broken-cache")), "broken-cache-0"),
    ).toBeUndefined();
  });
});

describe("a pod left from a scale-down", () => {
  const scaled = variantOf(named("cache"), { spec: { ...named("cache").spec, clusterSize: 2 } });
  // Being stopped, as a StatefulSet scaling down leaves it.
  const leftover = nodes(scaled).map((each) => (each.extra ? { ...each, ready: false } : each));

  it("is beyond the size: cache-2", () => {
    expect(leftover.filter((each) => each.extra).map((each) => each.name)).toEqual(["cache-2"]);
  });

  it("is not planned, and does not refuse the plan", () => {
    expect(restartAllPlan(scaled, leftover)).toEqual({
      steps: [
        { node: "cache-1", last: false },
        { node: "cache-0", last: true },
      ],
    });
  });

  it("does not stop a step, nor the wait for the set to settle", () => {
    expect(stepRefusal(scaled, { node: "cache-1", last: false }, leftover)).toBeUndefined();
    expect(isSettled(scaled, leftover)).toBe(true);
  });

  it("does not refuse restarting a pod of the set", () => {
    expect(nodeRestartRefusal(scaled, leftover, "cache-0")).toBeUndefined();
  });
});

describe("a restart's progress", () => {
  it("names the pods in order at the start, and counts each step done", () => {
    const plan = restartAllPlan(named("cache"), nodes(named("cache")));
    const steps = "steps" in plan ? plan.steps : [];

    expect(describeRestartStart("cache", steps)).toBe(
      "Restarting cache, one pod at a time: cache-1, then cache-2, then cache-0.",
    );
    expect(describeStepDone("cache", { node: "cache-1", last: false }, 1, steps.length)).toBe(
      "cache: restart cache-1, done (1 of 3).",
    );
  });

  it("offers a bulk Restart for every kind but a cluster, which would refuse each one", () => {
    expect(BULK_RESTART_TOOLTIP.Cluster).toBeUndefined();
    expect(restartAllPlan(named("shards"), nodes(named("shards")))).toEqual({
      refused: CLUSTER_RESTART_REFUSAL,
    });
    expect(BULK_RESTART_TOOLTIP.Replication).toMatch(/replicas first and the master last/);
    expect(BULK_RESTART_TOOLTIP.Sentinel).toMatch(/sentinel pod/);
    expect(BULK_RESTART_TOOLTIP.Standalone).toMatch(/the pod of each/);
  });
});

describe("waiting for a restarted pod", () => {
  const pod = (name: string) => pods().find((each) => each.getName() === name) as PodLike;
  const before = pod("cache-0");
  const uid = before.metadata.uid ?? "";
  const remade = (from: PodLike, change: Partial<PodLike>): PodLike => ({
    ...from,
    getName: () => from.getName(),
    getNs: () => from.getNs(),
    ...change,
  });

  it("knows it by a new uid, whatever the clocks say", () => {
    const later = remade(before, {
      status: { ...before.status, startTime: "2099-01-01T00:00:00Z" },
    });
    const replaced = remade(before, {
      metadata: { ...before.metadata, uid: pod("cache-2").metadata.uid },
      status: { ...before.status, startTime: "2000-01-01T00:00:00Z" },
    });

    expect(podReplaced(before, uid)).toBe(false);
    expect(podReplaced(later, uid)).toBe(false);
    expect(podReplaced(undefined, uid)).toBe(false);
    expect(podReplaced(replaced, uid)).toBe(true);
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

  it("lists a cluster's nodes as it sees them, where a ghost node shows", () => {
    expect(commandsOf(named("shards")).map((each) => each.command)).toContain(
      `kubectl exec -n redis shards-leader-0 -c shards-leader -- sh -c 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" cluster nodes'`,
    );
    expect(commandsOf(named("cache")).some((each) => each.command.includes("cluster nodes"))).toBe(
      false,
    );
  });

  it("finds the operator by its image, as Helm or kustomize installed it", () => {
    const commands = commandsOf(named("cache"));

    expect(commands.map((each) => each.command)).toContain(
      "kubectl get deployments -A -o wide | grep -E '/redis-operator[:@]'",
    );
    expect(commands.find((each) => each.label.startsWith("The operator's log"))?.command).toBe(
      String.raw`kubectl get deployments -A --no-headers -o 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,IMAGES:.spec.template.spec.containers[*].image' | awk '$3 ~ /\/redis-operator[:@]/ { print "-n", $1, "deploy/" $2; exit }' | xargs kubectl logs | grep '"cache"'`,
    );
    expect(commands.some((each) => each.command.includes("redis-operator-system"))).toBe(false);
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

describe("a pod restart, checked again at OK", () => {
  const cache = named("cache");
  const replica = () => nodes(cache).find((each) => each.role === "replica") as RedisNode;

  it("goes ahead when the pods are as they were confirmed", () => {
    expect(nodeRestartRefusalNow(cache, nodes(cache), replica().name, "replica")).toBeUndefined();
  });

  it("refuses when another pod went down, or the pod's role changed, since the dialog opened", () => {
    const target = replica().name;
    const sibling = nodes(cache).find((each) => each.name !== target) as RedisNode;

    expect(
      nodeRestartRefusalNow(
        cache,
        nodes(cache).map((each) => (each.name === sibling.name ? { ...each, ready: false } : each)),
        target,
        "replica",
      ),
    ).toMatch(/Another pod is not ready/);
    expect(
      nodeRestartRefusalNow(
        cache,
        nodes(cache).map((each) => ({
          ...each,
          role: each.name === target ? ("master" as const) : ("replica" as const),
        })),
        target,
        "replica",
      ),
    ).toBe(`${target} is now master, not the replica confirmed; nothing was changed.`);
  });
});
