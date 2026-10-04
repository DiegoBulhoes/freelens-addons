import { describe, expect, it } from "vitest";

import { dataMembers, membersOf, primaryOf } from "../src/renderer/api/members";
import {
  connectionSecretOf,
  describeStep,
  effectiveFcv,
  isSettled,
  memberRestartRefusal,
  mongoshCommand,
  podBackAfter,
  RESTARTED_AT,
  replicaSetCommands,
  restartAllPlan,
  rollingRestartPatch,
  rollingRestartRefusal,
  scalePatch,
  scaleRefusal,
  scaleWarnings,
  seriesOf,
  stepRefusal,
  switchPatch,
  switchRefusal,
} from "../src/renderer/api/operations";
import { agentsOf } from "../src/renderer/api/rows";
import type { ReplicaSetLike } from "../src/renderer/api/types";
import { agents, named, pods, pvcs, replicaSets } from "./fixtures";

const set = (name: string) => named(replicaSets(), name);
const membersOfSet = (rs: ReplicaSetLike) => membersOf(rs, pods(), pvcs(), agentsOf(rs, agents()));

function changed(
  rs: ReplicaSetLike,
  spec: Partial<ReplicaSetLike["spec"]>,
  status?: ReplicaSetLike["status"],
) {
  return {
    ...rs,
    getName: () => rs.getName(),
    getNs: () => rs.getNs(),
    spec: { ...rs.spec, ...spec },
    status: status ?? rs.status,
  };
}

describe("reading the version", () => {
  it("reads series and the FCV in effect", () => {
    expect(seriesOf("8.0.12")).toBe("8.0");
    expect(seriesOf("8.0.12-ent")).toBe("8.0");
    expect(seriesOf(undefined)).toBeUndefined();
    expect(effectiveFcv(set("sessions-rs"))).toBe("7.0");
    expect(effectiveFcv(changed(set("sessions-rs"), { featureCompatibilityVersion: "6.0" }))).toBe(
      "6.0",
    );
    expect(effectiveFcv(set("upgrade-rs"))).toBeUndefined();
  });
});

describe("scaling", () => {
  it("refuses a count that is not a positive whole number, too large, or unchanged", () => {
    const rs = set("catalog-rs");

    expect(scaleRefusal(rs, 0)).toMatch(/at least one/);
    expect(scaleRefusal(rs, 2.5)).toMatch(/at least one/);
    expect(scaleRefusal(rs, 51)).toMatch(/at most 50/);
    expect(scaleRefusal(rs, 3)).toMatch(/already has 3/);
    expect(scaleRefusal(rs, 5)).toBeUndefined();
  });

  it("warns of an even vote, of removed members and of a lone member", () => {
    expect(scaleWarnings(set("catalog-rs"), 4)[0]).toMatch(/4 voting members can split/);
    expect(scaleWarnings(set("catalog-rs"), 1)).toEqual([
      "Removes catalog-rs-1, catalog-rs-2; their volumes are kept.",
      "With one member there is no copy to fail over to.",
    ]);
    // Two data members and an arbiter: three voters.
    expect(scaleWarnings(set("sessions-rs"), 4)).toEqual([]);
  });

  it("keeps memberConfig the same length as the members, filling new ones with defaults", () => {
    expect(scalePatch(set("catalog-rs"), 4).spec.memberConfig).toEqual([
      { priority: "1", votes: 1 },
      { priority: "1", votes: 1 },
      { priority: "2", votes: 1 },
      { priority: "1", votes: 1 },
    ]);
    expect(scalePatch(set("sessions-rs"), 3)).toEqual({ spec: { members: 3 } });
  });
});

describe("switching the primary", () => {
  it("raises the target's priority above every other", () => {
    const rs = set("catalog-rs");

    expect(switchRefusal(rs, membersOfSet(rs), "catalog-rs-0")).toBeUndefined();
    expect(switchPatch(rs, membersOfSet(rs), "catalog-rs-0").spec.memberConfig).toEqual([
      { priority: "2", votes: 1 },
      { priority: "1", votes: 1 },
      { priority: "1", votes: 1 },
    ]);
    expect(
      switchPatch(set("sessions-rs"), membersOfSet(set("sessions-rs")), "sessions-rs-1").spec
        .memberConfig,
    ).toEqual([
      { priority: "1", votes: 1 },
      { priority: "2", votes: 1 },
    ]);
  });

  it("refuses the primary, an arbiter, a member of unknown role, and a set not running", () => {
    const rs = set("sessions-rs");
    const members = membersOfSet(rs);
    const primary = primaryOf(members)?.name ?? "";
    const secondary = dataMembers(members).find((each) => each.name !== primary)?.name ?? "";

    expect(switchRefusal(rs, members, primary)).toMatch(/already the primary/);
    expect(switchRefusal(rs, members, "sessions-rs-arb-0")).toMatch(/not a data member/);
    expect(switchRefusal(rs, membersOf(rs, pods(), pvcs(), {}), secondary)).toMatch(
      /could not be read/,
    );
    expect(switchRefusal(set("legacy-rs"), [], "legacy-rs-0")).toMatch(/Only a running/);
    expect(
      switchRefusal(
        rs,
        members.map((each) => ({ ...each, ready: false })),
        secondary,
      ),
    ).toMatch(/not a ready secondary/);
    expect(
      switchRefusal(
        rs,
        members.map((each) =>
          each.role === "primary" ? { ...each, role: "down" as const } : each,
        ),
        secondary,
      ),
    ).toMatch(/no primary/);
  });

  it("refuses while a member is still applying its last change", () => {
    const rs = set("catalog-rs");
    const busy = membersOfSet(rs).map((each, at) =>
      at === 1 ? { ...each, inGoalState: false } : each,
    );

    expect(switchRefusal(rs, busy, "catalog-rs-0")).toMatch(/still applying/);
    expect(restartAllPlan(rs, busy)).toEqual({
      refused: "A member is still applying its last change.",
    });
  });
});

describe("restarting", () => {
  it("asks the operator for a rolling restart through the pod template", () => {
    expect(rollingRestartPatch(0).spec.statefulSet.spec.template.metadata.annotations).toEqual({
      [RESTARTED_AT]: "1970-01-01T00:00:00.000Z",
    });
    expect(rollingRestartRefusal(set("catalog-rs"))).toBeUndefined();
    expect(rollingRestartRefusal(set("legacy-rs"))).toMatch(/not running/);
  });

  it("refuses to restart a member when the rest would be short of a majority", () => {
    const rs = set("catalog-rs");
    const members = membersOfSet(rs);
    const oneDown = members.map((each) =>
      each.name === "catalog-rs-1" ? { ...each, ready: false } : each,
    );

    expect(memberRestartRefusal(members, "catalog-rs-0")).toBeUndefined();
    expect(memberRestartRefusal(oneDown, "catalog-rs-0")).toMatch(
      /1 of 3 members up, short of a majority/,
    );
    // Already down: restarting it costs nothing.
    expect(memberRestartRefusal(oneDown, "catalog-rs-1")).toBeUndefined();
    expect(memberRestartRefusal(membersOfSet(set("reporting-rs")), "reporting-rs-0")).toMatch(
      /no pod/,
    );
  });

  it("plans every other member first and the primary last, touching no priority", () => {
    const rs = set("catalog-rs");
    const plan = restartAllPlan(rs, membersOfSet(rs));

    expect("steps" in plan && plan.steps.map(describeStep)).toEqual([
      "restart catalog-rs-0",
      "restart catalog-rs-1",
      "restart catalog-rs-2, the primary",
    ]);
  });

  it("restarts the arbiter with the secondaries", () => {
    const rs = set("sessions-rs");
    const plan = restartAllPlan(rs, membersOfSet(rs));

    const primary = primaryOf(membersOfSet(rs))?.name;
    const secondary = primary === "sessions-rs-0" ? "sessions-rs-1" : "sessions-rs-0";

    expect("steps" in plan && plan.steps.map(describeStep)).toEqual([
      `restart ${secondary}`,
      "restart sessions-rs-arb-0",
      `restart ${primary}, the primary`,
    ]);
  });

  it("restarts a lone member as the primary", () => {
    const rs = set("catalog-rs");
    const lone = membersOfSet(rs).filter((each) => each.role === "primary");

    expect(restartAllPlan(rs, lone)).toEqual({
      steps: [{ member: "catalog-rs-2", primary: true }],
    });
  });

  it("refuses when a member is down, the primary is unknown, or the set is not running", () => {
    const rs = set("catalog-rs");
    const members = membersOfSet(rs);

    expect(
      restartAllPlan(
        rs,
        members.map((each) => (each.name === "catalog-rs-0" ? { ...each, ready: false } : each)),
      ),
    ).toEqual({
      refused: "catalog-rs-0 is not ready; restarting the others could leave no majority.",
    });
    expect(restartAllPlan(rs, membersOf(rs, pods(), pvcs(), {}))).toMatchObject({
      refused: expect.stringMatching(/primary could not be read/),
    });
    expect(restartAllPlan(set("legacy-rs"), [])).toEqual({ refused: "It is not running." });
  });

  it("re-checks each step against fresh members", () => {
    const rs = set("catalog-rs");
    const members = membersOfSet(rs);

    expect(stepRefusal({ member: "catalog-rs-0", primary: false }, members)).toBeUndefined();
    expect(stepRefusal({ member: "catalog-rs-2", primary: true }, members)).toBeUndefined();
    expect(stepRefusal({ member: "catalog-rs-2", primary: false }, members)).toMatch(
      /became the primary; it was meant to go last/,
    );
    expect(stepRefusal({ member: "catalog-rs-9", primary: false }, members)).toMatch(/has no pod/);
    expect(
      stepRefusal(
        { member: "catalog-rs-0", primary: false },
        members.map((each) => (each.name === "catalog-rs-1" ? { ...each, ready: false } : each)),
      ),
    ).toMatch(/Another member/);
  });

  it("counts a member back once a new pod has started after the delete and is Ready", () => {
    const pod = named(pods(), "catalog-rs-0");
    const started = Date.parse(pod.status?.startTime ?? "");

    expect(podBackAfter(pod, started)).toBe(true);
    expect(podBackAfter(pod, started + 60_000)).toBe(false);
    expect(podBackAfter(named(pods(), "upgrade-rs-0"), 0)).toBe(false);
    expect(podBackAfter(undefined, 0)).toBe(false);
  });
});

describe("connecting", () => {
  it("opens mongosh with the first user's connection string, read in the shell", () => {
    const command = mongoshCommand(set("catalog-rs"), "catalog-rs-2");

    expect(command).toBe(
      `kubectl exec -it -n mongodb catalog-rs-2 -c mongod -- env HOME=/tmp mongosh "$(kubectl get secret -n mongodb catalog-rs-admin-catalog-admin -o jsonpath='{.data.connectionString\\.standard}' | base64 -d)"`,
    );
  });

  it("gives mongosh the CA the operator mounts when TLS is on", () => {
    expect(mongoshCommand(set("secure-rs"), "secure-rs-0")).toBe(
      `kubectl exec -it -n mongodb secure-rs-0 -c mongod -- sh -c 'HOME=/tmp exec mongosh --tlsCAFile /var/lib/tls/ca/*.pem "$@"' mongosh "$(kubectl get secret -n mongodb secure-rs-admin-secure-admin -o jsonpath='{.data.connectionString\\.standard}' | base64 -d)"`,
    );
  });

  it("opens mongosh without credentials when the set declares no user", () => {
    expect(mongoshCommand(set("legacy-rs"), "legacy-rs-0")).toBe(
      "kubectl exec -it -n mongodb legacy-rs-0 -c mongod -- env HOME=/tmp mongosh",
    );
  });

  it("names a user's connection Secret as the operator does, unless the user names one", () => {
    const rs = set("catalog-rs");
    const user = rs.spec.users?.[0];

    expect(user && connectionSecretOf(rs, user)).toBe("catalog-rs-admin-catalog-admin");
    expect(user && connectionSecretOf(rs, { ...user, connectionStringSecretName: "mine" })).toBe(
      "mine",
    );
  });

  it("offers commands to look further", () => {
    expect(replicaSetCommands(set("catalog-rs")).map((each) => each.command)).toContain(
      "kubectl describe mongodbcommunity -n mongodb catalog-rs",
    );
  });
});

describe("waiting for a cluster to settle", () => {
  it("is settled when running with every member ready and at its agent's goal", () => {
    const rs = set("catalog-rs");

    expect(isSettled(rs, membersOfSet(rs))).toBe(true);
  });

  it("is not while a member is short of its goal, not ready, or the set is not running", () => {
    const rs = set("catalog-rs");
    const members = membersOfSet(rs);

    expect(
      isSettled(
        rs,
        members.map((each, at) => (at === 0 ? { ...each, inGoalState: false } : each)),
      ),
    ).toBe(false);
    expect(
      isSettled(
        rs,
        members.map((each, at) => (at === 1 ? { ...each, ready: false } : each)),
      ),
    ).toBe(false);
    expect(isSettled(changed(rs, {}, { ...rs.status, phase: "Pending" }), members)).toBe(false);
    // No agent read: not knowing is not settled.
    expect(isSettled(rs, membersOf(rs, pods(), pvcs(), {}))).toBe(false);
    expect(isSettled(rs, [])).toBe(false);
  });
});
