import { describe, expect, it } from "vitest";

import { isReady, kindOf, masterOf, nodesOf, readyCount, setsOf } from "../src/renderer/api/nodes";
import { named, pods, pvcs } from "./fixtures";

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
