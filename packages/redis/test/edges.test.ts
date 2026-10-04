import { describe, expect, it } from "vitest";

import { healthOf } from "../src/renderer/api/health";
import { nodesOf } from "../src/renderer/api/nodes";
import { failoverCommand, redisCliCommand } from "../src/renderer/api/operations";
import { describeHeadline } from "../src/renderer/api/rows";
import type { PodLike, RedisLike } from "../src/renderer/api/types";
import {
  connectionUrls,
  eventsOf,
  passwordCommand,
  secretNamesFrom,
} from "../src/renderer/api/upkeep";
import { ago } from "../src/renderer/api/verdict";
import { events, named, pods, pvcs } from "./fixtures";

// Real objects with one field changed: shapes a live cluster also produces.
function variant(
  object: RedisLike,
  change: Partial<Pick<RedisLike, "spec" | "status">>,
  ns?: string,
): RedisLike {
  return {
    ...object,
    kind: object.kind,
    getName: () => object.getName(),
    getNs: () => (ns === undefined ? object.getNs() : ns || undefined),
    spec: change.spec ?? object.spec,
    status: "status" in change ? change.status : object.status,
  };
}

function podVariant(pod: PodLike, status: PodLike["status"]): PodLike {
  return { ...pod, getName: () => pod.getName(), getNs: () => pod.getNs(), status };
}

const sessionsPod = () => pods().find((each) => each.getName() === "sessions-0") as PodLike;

describe("a pod with little to say", () => {
  const sessions = named("sessions");

  it("says why it is not scheduled from the reason alone, and how a container last exited", () => {
    const unscheduled = podVariant(sessionsPod(), {
      conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable" }],
    });
    const crashed = podVariant(sessionsPod(), {
      containerStatuses: [
        {
          name: "sessions",
          ready: false,
          restartCount: 2,
          lastState: { terminated: { reason: "OOMKilled" } },
        },
      ],
    });
    const quiet = podVariant(sessionsPod(), {
      containerStatuses: [{ name: "sessions", ready: false, restartCount: 0 }],
    });

    expect(nodesOf(sessions, [unscheduled], [])[0]?.problem).toBe("Not scheduled: Unschedulable");
    expect(nodesOf(sessions, [crashed], [])[0]).toMatchObject({
      restarts: 2,
      problem: "sessions last exited: OOMKilled (code ?)",
    });
    expect(nodesOf(sessions, [quiet], [])[0]?.problem).toBeUndefined();
    expect(healthOf(sessions, nodesOf(sessions, [quiet], []))).toMatchObject({
      label: "Down",
      reason: "No pod is ready.",
    });
  });
});

describe("a sentinel with little to say", () => {
  const sentinel = named("cache-sentinel");

  it("names the replication it lost, or says it names none", () => {
    expect(
      healthOf(sentinel, nodesOf(sentinel, pods(), pvcs()), { watchedExists: false }).reason,
    ).toMatch(/replication cache does not exist/);

    const bare = variant(sentinel, { spec: { ...sentinel.spec, redisSentinelConfig: {} } });

    expect(healthOf(bare, nodesOf(bare, pods(), pvcs()), { watchedExists: false }).reason).toMatch(
      /replication it names/,
    );
  });

  it("calls a sentinel set without quorum and one pod down degraded, not below quorum", () => {
    const noQuorum = variant(sentinel, {
      spec: { ...sentinel.spec, redisSentinelConfig: { redisReplicationName: "cache" } },
    });
    const fewer = nodesOf(noQuorum, pods(), pvcs()).map((each, at) =>
      at === 0 ? { ...each, ready: false } : each,
    );

    expect(healthOf(noQuorum, fewer, { watchedExists: true }).label).toBe("Degraded");
  });

  it("asks myMaster when no group is named", () => {
    expect(
      failoverCommand(
        variant(sentinel, { spec: { ...sentinel.spec, redisSentinelConfig: {} } }),
      )[2],
    ).toMatch(/failover myMaster$/);
  });
});

describe("a cluster with little to say", () => {
  it("is down when no pod is ready", () => {
    const shards = named("shards");
    const down = nodesOf(shards, pods(), pvcs()).map((each) => ({ ...each, ready: false }));

    expect(healthOf(shards, down).label).toBe("Down");
  });
});

describe("names and keys left out", () => {
  it("defaults the namespace, and escapes a key with dots for jsonpath", () => {
    const loose = variant(named("cache"), {}, "");
    const dotted = variant(named("cache"), {
      spec: {
        ...named("cache").spec,
        kubernetesConfig: { redisSecret: { name: "s", key: "redis.password" } },
      },
    });

    expect(connectionUrls(loose)[0]?.url).toBe("redis://cache-master.default.svc:6379");
    expect(passwordCommand(dotted)).toBe(
      "kubectl get secret -n redis s -o jsonpath='{.data.redis\\.password}' | base64 -d",
    );
    expect(
      passwordCommand(
        variant(named("cache"), {
          spec: { ...named("cache").spec, kubernetesConfig: { redisSecret: { name: "s" } } },
        }),
      ),
    ).toContain("{.data.password}");
    expect(
      redisCliCommand(loose, { name: "cache-0", ready: true, restarts: 0, extra: false }),
    ).toContain("-n default ");
  });

  it("keeps an event without a message or a time, and a Secret without annotations", () => {
    const legacy = named("legacy-store");
    const [first] = eventsOf(events(), legacy);
    const bare = first && {
      ...first,
      getName: () => "bare",
      getNs: () => first.getNs(),
      message: undefined,
      lastTimestamp: undefined,
      eventTime: undefined,
    };

    expect(bare && eventsOf([bare, first], legacy).map((each) => each.getName())).toEqual([
      first?.getName(),
      "bare",
    ]);
    expect(secretNamesFrom({ items: [{ metadata: { name: "a" } }] })).toEqual([
      { metadata: { name: "a", namespace: undefined, annotations: {} } },
    ]);
  });

  it("headlines one healthy object, and says just now", () => {
    expect(describeHeadline(0, 2)).toBe("2 Redis objects, all healthy");
    expect(ago("1970-01-01T00:00:00Z", 10_000)).toBe("just now");
  });
});
