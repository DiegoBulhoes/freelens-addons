import { KubeEvent, Node } from "@freelensapp/kube-object";
import { describe, expect, it } from "vitest";

import { getPressure, RECENT_EVENT_MS } from "../src/renderer/api/pressure";
import { events, nodes } from "./fixtures";

/** The newest warning in the fixtures, so "recent" means what it meant then. */
function newestEventAt(): number {
  return Math.max(
    ...events().map((event) => Date.parse(event.lastTimestamp ?? event.eventTime ?? "")),
  );
}

const NOW = newestEventAt();

function nodeWith(conditions: unknown[], extra: Record<string, unknown> = {}): Node {
  return new Node({
    apiVersion: "v1",
    kind: "Node",
    metadata: { name: "node-a", uid: "n1", resourceVersion: "1", selfLink: "/api/v1/nodes/node-a" },
    spec: extra,
    status: { conditions },
  } as never);
}

function eventAbout(target: string, reason: string, at: number, kind = "Node"): KubeEvent {
  return new KubeEvent({
    apiVersion: "v1",
    kind: "Event",
    metadata: {
      name: `${target}.${reason}`,
      namespace: "default",
      uid: `${target}-${reason}`,
      resourceVersion: "1",
      selfLink: `/api/v1/namespaces/default/events/${target}.${reason}`,
    },
    involvedObject: { kind, name: target },
    type: "Warning",
    reason,
    message: `${reason} on ${target}`,
    lastTimestamp: new Date(at).toISOString(),
  } as never);
}

describe("pressure, from the cluster as it was", () => {
  it("surfaces the kubelet's recent warnings about the node", () => {
    const pressures = getPressure(nodes(), events(), NOW);

    expect(pressures.length).toBeGreaterThan(0);
    expect(pressures.map((pressure) => pressure.condition)).toContain("FreeDiskSpaceFailed");
  });

  it("links each pressure back to a node that can be opened", () => {
    const names = nodes().map((node) => node.getName());

    for (const pressure of getPressure(nodes(), events(), NOW)) {
      if (names.includes(pressure.node)) expect(pressure.selfLink).not.toBe("");
    }
  });

  it("reports one row per problem, not one per repeat of the same warning", () => {
    const pressures = getPressure(nodes(), events(), NOW);
    const keys = pressures.map((pressure) => `${pressure.node}/${pressure.condition}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("pressure, when the node is in trouble", () => {
  it("reports a condition the kubelet has set", () => {
    const pressures = getPressure(
      [nodeWith([{ type: "DiskPressure", status: "True", message: "out of disk" }])],
      [],
      NOW,
    );

    expect(pressures).toEqual([
      expect.objectContaining({
        node: "node-a",
        condition: "DiskPressure",
        message: "out of disk",
      }),
    ]);
  });

  it("reads a node that is not Ready, which is the reverse of every other condition", () => {
    const pressures = getPressure(
      [nodeWith([{ type: "Ready", status: "False", message: "kubelet stopped posting" }])],
      [],
      NOW,
    );

    expect(pressures).toEqual([
      expect.objectContaining({ condition: "NotReady", message: "kubelet stopped posting" }),
    ]);
  });

  it("reports a cordoned node, which no condition covers", () => {
    const pressures = getPressure(
      [nodeWith([{ type: "Ready", status: "True" }], { unschedulable: true })],
      [],
      NOW,
    );

    expect(pressures).toEqual([expect.objectContaining({ condition: "Unschedulable" })]);
  });
});

describe("pressure, given events that should not count", () => {
  it("drops a warning older than the window", () => {
    const stale = eventAbout("node-a", "ImageGCFailed", NOW - RECENT_EVENT_MS - 1);

    expect(getPressure([], [stale], NOW)).toEqual([]);
  });

  it("keeps a warning right at the edge of the window", () => {
    const edge = eventAbout("node-a", "ImageGCFailed", NOW - RECENT_EVENT_MS);

    expect(getPressure([], [edge], NOW)).toHaveLength(1);
  });

  it("ignores a warning about something that is not a node", () => {
    const podEvent = eventAbout("some-pod", "BackOff", NOW, "Pod");

    expect(getPressure([], [podEvent], NOW)).toEqual([]);
  });

  it("ignores an event with an unparseable timestamp", () => {
    const undated = new KubeEvent({
      apiVersion: "v1",
      kind: "Event",
      metadata: {
        name: "x",
        namespace: "default",
        uid: "x",
        resourceVersion: "1",
        selfLink: "/api/v1/namespaces/default/events/x",
      },
      involvedObject: { kind: "Node", name: "node-a" },
      type: "Warning",
      reason: "Whatever",
    } as never);

    expect(getPressure([], [undated], NOW)).toEqual([]);
  });

  it("leaves the link empty for an event about a node it cannot see", () => {
    const orphan = eventAbout("node-gone", "DiskPressure", NOW);
    const [pressure] = getPressure([], [orphan], NOW);

    expect(pressure?.selfLink).toBe("");
  });

  it("falls back to eventTime when the legacy lastTimestamp is absent", () => {
    const modern = new KubeEvent({
      apiVersion: "v1",
      kind: "Event",
      metadata: {
        name: "modern",
        namespace: "default",
        uid: "modern",
        resourceVersion: "1",
        selfLink: "/api/v1/namespaces/default/events/modern",
      },
      involvedObject: { kind: "Node", name: "node-a" },
      type: "Warning",
      reason: "DiskPressure",
      eventTime: new Date(NOW).toISOString(),
    } as never);

    expect(getPressure([], [modern], NOW)).toHaveLength(1);
  });

  it("labels a warning with no reason rather than leaving the chip blank", () => {
    const reasonless = new KubeEvent({
      apiVersion: "v1",
      kind: "Event",
      metadata: {
        name: "reasonless",
        namespace: "default",
        uid: "reasonless",
        resourceVersion: "1",
        selfLink: "/api/v1/namespaces/default/events/reasonless",
      },
      involvedObject: { kind: "Node", name: "node-a" },
      type: "Warning",
      lastTimestamp: new Date(NOW).toISOString(),
    } as never);

    expect(getPressure([], [reasonless], NOW)[0]?.condition).toBe("Warning");
  });

  it("ignores an event that is not a warning at all", () => {
    const normal = new KubeEvent({
      apiVersion: "v1",
      kind: "Event",
      metadata: {
        name: "normal",
        namespace: "default",
        uid: "normal",
        resourceVersion: "1",
        selfLink: "/api/v1/namespaces/default/events/normal",
      },
      involvedObject: { kind: "Node", name: "node-a" },
      type: "Normal",
      reason: "NodeReady",
      lastTimestamp: new Date(NOW).toISOString(),
    } as never);

    expect(getPressure([], [normal], NOW)).toEqual([]);
  });

  it("reports nothing at all for a healthy cluster", () => {
    expect(getPressure([nodeWith([{ type: "Ready", status: "True" }])], [], NOW)).toEqual([]);
    expect(getPressure([], [], NOW)).toEqual([]);
  });
});
