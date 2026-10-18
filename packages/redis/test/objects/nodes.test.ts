import { describe, expect, it } from "vitest";

import {
  appSelector,
  cliTarget,
  isReady,
  kindOf,
  masterOf,
  nodesOf,
  readyCount,
  setsOf,
} from "../../src/renderer/api/objects/nodes";
import type { RedisLike } from "../../src/renderer/api/shared/types";
import { named, pods, pvcs } from "../support/fixtures";

const nodes = (name: string) => nodesOf(named(name), pods(), pvcs());

describe("the kind of each object", () => {
  it("reads it from the custom resource", () => {
    expect(
      ["cache", "shards", "sessions", "cache-sentinel"].map((name) => kindOf(named(name))),
    ).toEqual(["Replication", "Cluster", "Standalone", "Sentinel"]);
  });

  it("knows the StatefulSets the operator makes for each", () => {
    expect(setsOf(named("shards")).map((each) => [each.app, each.wanted])).toEqual([
      ["shards-leader", 3],
      ["shards-follower", 3],
    ]);
    expect(setsOf(named("cache-sentinel"))[0]?.app).toBe("cache-sentinel-sentinel");
    expect(setsOf(named("sessions"))).toEqual([{ app: "sessions", wanted: 1 }]);
  });
});

describe("the pods of a replication", () => {
  it("names one master and the rest replicas, from the operator's labels", () => {
    const list = nodes("cache");

    expect(list.map((each) => each.name)).toEqual(["cache-0", "cache-1", "cache-2"]);
    expect(list.filter((each) => each.role === "master")).toHaveLength(1);
    expect(list.filter((each) => each.role === "replica")).toHaveLength(2);
    expect(masterOf(list)?.name).toBe(named("cache").status?.masterNode);
  });

  it("carries the container, node, volume size and uptime", () => {
    const [first] = nodes("cache");

    expect(first).toMatchObject({ container: "cache", ready: true, problem: undefined });
    expect(first?.volume).toMatch(/Gi/);
    expect(first?.node).toBeTruthy();
    expect(first?.upSince).toMatch(/^\d{4}-/);
  });

  it("names each pod's claim, so the drawer can link it; a pod with none has none", () => {
    expect(nodes("cache").map((each) => each.claim)).toEqual([
      "cache-cache-0",
      "cache-cache-1",
      "cache-cache-2",
    ]);
    expect(nodes("cache-sentinel").every((each) => each.claim === undefined)).toBe(true);
  });
});

describe("the pods of a cluster", () => {
  it("lists leaders before followers, the leaders as masters", () => {
    const list = nodes("shards");

    expect(list.map((each) => [each.name, each.group, each.role])).toEqual([
      ["shards-leader-0", "leader", "master"],
      ["shards-leader-1", "leader", "master"],
      ["shards-leader-2", "leader", "master"],
      ["shards-follower-0", "follower", "replica"],
      ["shards-follower-1", "follower", "replica"],
      ["shards-follower-2", "follower", "replica"],
    ]);
    expect(readyCount(named("shards"), list)).toEqual({ ready: 6, wanted: 6 });
  });
});

describe("a pod left from a scale-down", () => {
  // The real cache asked for two pods: its cache-2 is then beyond the size.
  const cache = named("cache");
  const scaled: RedisLike = {
    ...cache,
    kind: cache.kind,
    getName: () => cache.getName(),
    getNs: () => cache.getNs(),
    spec: { ...cache.spec, clusterSize: 2 },
  };

  it("is listed and marked extra, and not counted ready", () => {
    const list = nodesOf(scaled, pods(), pvcs());

    expect(list.map((each) => [each.name, each.ready, each.extra])).toEqual([
      ["cache-0", true, false],
      ["cache-1", true, false],
      ["cache-2", true, true],
    ]);
    expect(readyCount(scaled, list)).toEqual({ ready: 2, wanted: 2 });
  });
});

describe("why a pod is not up", () => {
  it("names a volume that cannot bind", () => {
    expect(nodes("legacy-store")[0]?.problem).toMatch(
      /legacy-store-legacy-store-0 is not bound \(storage class no-such-class\)/,
    );
  });

  it("names an image that cannot be pulled", () => {
    expect(nodes("broken-cache")[0]?.problem).toMatch(/v9\.9\.999/);
  });

  it("lists pods it should have before they exist", () => {
    const list = nodes("broken-cache");

    expect(list.map((each) => each.name)).toEqual(["broken-cache-0", "broken-cache-1"]);
    expect(list[1]?.problem).toBe("It has no pod yet.");
  });

  it("gives sentinels and standalones their own role", () => {
    expect(nodes("cache-sentinel").every((each) => each.role === "sentinel")).toBe(true);
    expect(nodes("sessions")[0]?.role).toBe("standalone");
  });

  it("is not ready without a pod", () => {
    expect(isReady(undefined)).toBe(false);
  });
});

describe("where redis-cli opens", () => {
  it("on the master while it is ready, else on a ready replica, else nowhere", () => {
    const list = nodes("cache");
    const master = masterOf(list)?.name;
    const masterDown = list.map((each) =>
      each.name === master ? { ...each, ready: false } : each,
    );

    expect(cliTarget(list)?.name).toBe(master);
    expect(cliTarget(masterDown)).toMatchObject({ role: "replica", ready: true });
    expect(cliTarget(list.map((each) => ({ ...each, ready: false })))).toBeUndefined();
    expect(cliTarget(nodes("sessions"))?.name).toBe("sessions-0");
  });
});

describe("the label selector of an object's pods and volumes", () => {
  it("names each StatefulSet's app, so a poll reads no other pod", () => {
    expect(appSelector(named("shards"))).toBe("app in (shards-leader,shards-follower)");
    expect(appSelector(named("cache-sentinel"))).toBe("app in (cache-sentinel-sentinel)");

    const apps = new Set(setsOf(named("shards")).map((each) => each.app));
    const own = pods().filter((each) => apps.has(each.metadata.labels?.app ?? ""));

    expect(nodesOf(named("shards"), own, pvcs()).every((each) => each.pod)).toBe(true);
  });
});
