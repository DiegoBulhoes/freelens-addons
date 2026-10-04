import { describe, expect, it } from "vitest";

import { readAgent, stuckAt } from "../src/renderer/api/agent";
import { membersOf } from "../src/renderer/api/members";
import {
  mongoshCommand,
  replicaSetCommands,
  restartAllPlan,
  switchPatch,
} from "../src/renderer/api/operations";
import { replicaSetHealth } from "../src/renderer/api/replica-sets";
import {
  agentsOf,
  attentionItems,
  describeHeadline,
  replicaSetRows,
} from "../src/renderer/api/rows";
import type { PodLike, ReplicaSetLike } from "../src/renderer/api/types";
import { replicaSetEvents, securityOf, usersOf } from "../src/renderer/api/upkeep";
import { agents, events, inventory, named, pods, pvcs, replicaSets } from "./fixtures";

// Real objects with one field taken away or changed: the shapes a live cluster also produces.
function variant(
  rs: ReplicaSetLike,
  change: Partial<Pick<ReplicaSetLike, "spec" | "status">>,
  ns?: string,
) {
  return {
    ...rs,
    getName: () => rs.getName(),
    getNs: () => (ns === undefined ? rs.getNs() : ns || undefined),
    spec: change.spec ?? rs.spec,
    status: "status" in change ? change.status : rs.status,
  };
}

function podVariant(pod: PodLike, status: PodLike["status"]): PodLike {
  return { ...pod, getName: () => pod.getName(), getNs: () => pod.getNs(), status };
}

describe("an agent file missing parts", () => {
  it("has no cause without moves or steps, and an unknown role without a state", () => {
    expect(stuckAt([{}])).toBeUndefined();
    expect(stuckAt([{ moves: [{ move: "m" }] }])).toBeUndefined();
    expect(readAgent({ statuses: { x: {} } }, "x")?.role).toBe("unknown");
  });
});

describe("a member's pod", () => {
  const rs = named(replicaSets(), "legacy-rs");
  const pending = named(pods(), "legacy-rs-0");

  it("says why it is not scheduled, from the message or else the reason", () => {
    const [member] = membersOf(rs, pods(), [], {});

    expect(member?.problem).toMatch(/^Not scheduled: .*PersistentVolumeClaims/);

    const bare = podVariant(pending, {
      phase: "Pending",
      conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable" }],
    });

    expect(membersOf(rs, [bare], [], {})[0]?.problem).toBe("Not scheduled: Unschedulable");
  });

  it("says how a container last exited when it is not ready", () => {
    const crashed = podVariant(pending, {
      containerStatuses: [
        {
          name: "mongod",
          ready: false,
          restartCount: 3,
          lastState: { terminated: { reason: "OOMKilled" } },
        },
      ],
    });

    expect(membersOf(rs, [crashed], [], {})[0]).toMatchObject({
      restarts: 3,
      problem: "mongod last exited: OOMKilled (code ?)",
    });
  });

  it("has no cause when nothing in it explains the wait", () => {
    const quiet = podVariant(pending, {
      containerStatuses: [{ name: "mongod", ready: false, restartCount: 0 }],
    });

    expect(membersOf(rs, [quiet], [], {})[0]?.problem).toBeUndefined();
  });
});

describe("a cluster with little to say", () => {
  const catalog = named(replicaSets(), "catalog-rs");
  const members = (rs: ReplicaSetLike) => membersOf(rs, pods(), pvcs(), agentsOf(rs, agents()));

  it("falls back to a plain reason when the operator gives none", () => {
    const failed = variant(named(replicaSets(), "legacy-rs"), { status: { phase: "Failed" } });

    expect(replicaSetHealth(failed, members(failed)).reason).toMatch(/not bound/);
    expect(replicaSetHealth(failed, []).reason).toBe("The operator gave up on it.");

    const down = variant(failed, { status: { phase: "Pending" } });

    expect(replicaSetHealth(down, []).reason).toBe("No member is ready.");
  });

  it("says when a version change is waiting on an unknown version or a member", () => {
    const upgrade = named(replicaSets(), "upgrade-rs");
    const half = variant(catalog, {
      spec: { ...catalog.spec, version: "8.0.13" },
      status: { phase: "Pending" },
    });

    expect(replicaSetHealth(half, members(half)).reason).toBe("Asked for 8.0.13, still on 8.0.12.");
    expect(
      replicaSetHealth(variant(upgrade, { status: { phase: "Pending" } }), members(catalog)).reason,
    ).toBe("Asked for 8.0.999, still on an unknown version.");

    const withProblem = members(half).map((each, at) =>
      at === 0 ? { ...each, problem: "stuck" } : each,
    );

    expect(replicaSetHealth(half, withProblem).reason).toBe(
      "Asked for 8.0.13, still on 8.0.12. stuck",
    );
  });

  it("calls a set with a member missing and no known cause degraded, plainly", () => {
    const fewer = members(catalog).slice(1);

    expect(
      replicaSetHealth(
        catalog,
        fewer.map((each) => ({ ...each, problem: undefined })),
      ).reason,
    ).toBe("2 of 3 members ready.");
  });

  it("calls a set with no phase yet starting", () => {
    const fresh = variant(catalog, { status: undefined });

    expect(replicaSetHealth(fresh, members(catalog)).label).toBe("Starting");
  });

  it("names a namespace even when the object has none", () => {
    const loose = variant(named(replicaSets(), "legacy-rs"), {}, "");

    expect(mongoshCommand(loose, "legacy-rs-0")).toContain("-n default ");
    expect(replicaSetCommands(loose)[0]?.command).toContain("-n default ");
    expect(
      attentionItems(replicaSetRows({ ...inventory(), replicaSets: [loose] }))[0]?.namespace,
    ).toBe("");
  });

  it("restarts nothing it does not know, and names every member that is down", () => {
    const all = members(catalog).map((each) => ({ ...each, ready: false }));

    expect(restartAllPlan(catalog, all)).toEqual({
      refused:
        "catalog-rs-0, catalog-rs-1, catalog-rs-2 are not ready; restarting the others could leave no majority.",
    });
    expect(
      switchPatch(catalog, members(catalog), "nobody").spec.memberConfig.map(
        (each) => each.priority,
      ),
    ).toEqual(["1", "1", "1"]);
  });
});

describe("users, security and events with fields left out", () => {
  it("handles a user without a password Secret reference, and a set without users", () => {
    const catalog = named(replicaSets(), "catalog-rs");
    const user = catalog.spec.users?.[0];
    const noRef = variant(catalog, {
      spec: { ...catalog.spec, users: user ? [{ ...user, passwordSecretRef: undefined }] : [] },
    });

    expect(usersOf(noRef, [])[0]?.hasPassword).toBe(true);
    expect(usersOf(variant(catalog, { spec: { ...catalog.spec, users: undefined } }), [])).toEqual(
      [],
    );
  });

  it("lists a user without a password Secret reference as missing nothing", () => {
    const reporting = named(replicaSets(), "reporting-rs");
    const user = reporting.spec.users?.[0];
    const noRef = variant(reporting, {
      spec: { ...reporting.spec, users: user ? [{ ...user, passwordSecretRef: undefined }] : [] },
      status: { phase: "Running" },
    });

    expect(
      attentionItems(replicaSetRows({ ...inventory(), replicaSets: [noRef] })).filter(
        (item) => item.kind === "User",
      ),
    ).toEqual([]);
  });

  it("states no authentication and metrics on the default port", () => {
    const catalog = named(replicaSets(), "catalog-rs");
    const secured = variant(catalog, {
      spec: { ...catalog.spec, security: { tls: { enabled: true } }, prometheus: {} },
    });

    expect(securityOf(secured).map((each) => each.value)).toEqual([
      "None",
      "Prometheus on port 9216",
    ]);
  });

  it("keeps an event without a message or a time", () => {
    const legacy = named(replicaSets(), "legacy-rs");
    const [first] = replicaSetEvents(events(), legacy);
    const bare = first && {
      ...first,
      getName: () => "bare",
      getNs: () => first.getNs(),
      message: undefined,
      lastTimestamp: undefined,
      eventTime: undefined,
    };

    expect(bare && replicaSetEvents([bare, first], legacy).map((each) => each.getName())).toEqual([
      first?.getName(),
      "bare",
    ]);
  });

  it("headlines a single set needing attention", () => {
    expect(describeHeadline(1, 1)).toBe("1 of 1 cluster needs attention");
  });
});
