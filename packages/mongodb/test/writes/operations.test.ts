import type { KubeObject } from "@freelensapp/kube-object";
import { describe, expect, it } from "vitest";

import { dataMembers, membersOf, primaryOf } from "../../src/renderer/api/clusters/members";
import { agentsOf, memberPodsOf } from "../../src/renderer/api/clusters/rows";
import { connectionOf, connectionSecretOf, usersOf } from "../../src/renderer/api/clusters/upkeep";
import type { ReplicaSetLike } from "../../src/renderer/api/shared/types";
import {
  checkedSwitchPatch,
  checkMemberRestart,
  describeStep,
  effectiveFcv,
  isSettled,
  memberRestartRefusal,
  memberSelector,
  mongoshCommand,
  mongoshTarget,
  offersSwitch,
  podReplaced,
  RESTARTED_AT,
  replicaSetCommands,
  restartAllPlan,
  restartingRefusal,
  rollingRestartPatch,
  rollingRestartRefusal,
  scaleAdvice,
  scalePatch,
  scaleRefusal,
  scaleWarnings,
  seriesOf,
  stepRefusal,
  switchPatch,
  switchRefusal,
  switchTarget,
  whileRestartingAll,
} from "../../src/renderer/api/writes/operations";
import { agents, named, pods, pvcs, replicaSets, secrets } from "../support/fixtures";

const set = (name: string) => named(replicaSets(), name);
const membersOfSet = (rs: ReplicaSetLike) => membersOf(rs, pods(), pvcs(), agentsOf(rs, agents()));
const connectionOfSet = (rs: ReplicaSetLike) => connectionOf(usersOf(rs, secrets()));

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
    expect(effectiveFcv(set("legacy-rs"))).toBeUndefined();
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

describe("members set never to be primary", () => {
  // catalog-rs with catalog-rs-1 made a non-voting member, as ledger-rs-2 is in the seed.
  const withVoteless = () => {
    const rs = set("catalog-rs");
    const config = rs.spec.memberConfig ?? [];

    return changed(rs, {
      memberConfig: config.map((each, at) => (at === 1 ? { votes: 0, priority: "0" } : each)),
    });
  };

  it("refuses one without a vote or with priority 0 as the new primary", () => {
    const rs = withVoteless();

    expect(switchRefusal(rs, membersOfSet(rs), "catalog-rs-1")).toBe(
      "catalog-rs-1 has no vote or priority 0: it is set never to become primary.",
    );

    const config = rs.spec.memberConfig ?? [];
    const unelectable = changed(rs, {
      memberConfig: config.map((each, at) => (at === 1 ? { votes: 1, priority: "0" } : each)),
    });

    expect(switchRefusal(unelectable, membersOfSet(unelectable), "catalog-rs-1")).toMatch(
      /never to become primary/,
    );
  });

  it("keeps them at priority 0 when another becomes primary", () => {
    const rs = withVoteless();

    expect(switchPatch(rs, membersOfSet(rs), "catalog-rs-0").spec.memberConfig).toEqual([
      { priority: "2", votes: 1 },
      { priority: "0", votes: 0 },
      { priority: "1", votes: 1 },
    ]);
  });

  it("adds members past the seventh voter without a vote, and says so", () => {
    const voters = (config: { votes?: number }[] = []) =>
      config.reduce((sum, each) => sum + (each.votes ?? 1), 0);
    const nine = scalePatch(set("catalog-rs"), 9).spec.memberConfig;

    expect(nine?.slice(3)).toEqual([
      ...Array.from({ length: 4 }, () => ({ votes: 1, priority: "1" })),
      { votes: 0, priority: "0" },
      { votes: 0, priority: "0" },
    ]);
    expect(voters(nine)).toBe(7);
    expect(scaleWarnings(set("catalog-rs"), 9)).toContain(
      "MongoDB counts at most 7 voters, so these join without a vote and never become primary: catalog-rs-7, catalog-rs-8.",
    );

    // No memberConfig and an arbiter: the operator would give all seven data members a vote.
    const sessions = scalePatch(set("sessions-rs"), 7).spec.memberConfig;

    expect(sessions).toHaveLength(7);
    expect(voters(sessions) + (set("sessions-rs").spec.arbiters ?? 0)).toBe(7);
    expect(scalePatch(withVoteless(), 4).spec.memberConfig?.[3]).toEqual({
      votes: 1,
      priority: "1",
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

    expect(memberRestartRefusal(rs, members, "catalog-rs-0")).toBeUndefined();
    expect(memberRestartRefusal(rs, oneDown, "catalog-rs-0")).toMatch(
      /1 of 3 members up, short of a majority/,
    );
    // Already down: restarting it costs nothing.
    expect(memberRestartRefusal(rs, oneDown, "catalog-rs-1")).toBeUndefined();

    const reporting = set("reporting-rs");

    expect(memberRestartRefusal(reporting, membersOfSet(reporting), "reporting-rs-0")).toMatch(
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

  it("counts a member back once another pod by its name is Ready, told by uid and not by any clock", () => {
    const old = named(pods(), "catalog-rs-0");
    const before = old.metadata.uid;
    // The pod that replaces it: same name, a new uid, and a start time the local clock knows nothing of.
    const replaced = {
      ...old,
      metadata: { ...old.metadata, uid: named(pods(), "catalog-rs-1").metadata.uid },
      status: { ...old.status, startTime: "1970-01-01T00:00:00Z" },
    };
    const stuck = named(pods(), "upgrade-rs-1");

    expect(podReplaced(old, before)).toBe(false);
    expect(podReplaced(replaced, before)).toBe(true);
    expect(
      podReplaced({ ...stuck, metadata: { ...stuck.metadata, uid: "new" } }, stuck.metadata.uid),
    ).toBe(false);
    expect(podReplaced(replaced, undefined)).toBe(false);
    expect(podReplaced(undefined, before)).toBe(false);
  });

  it("refuses a step whose pod has no uid, as a new one could not be told from it", () => {
    const rs = set("catalog-rs");
    const members = membersOfSet(rs).map((each) =>
      each.name === "catalog-rs-0" && each.pod
        ? { ...each, pod: { ...each.pod, metadata: { ...each.pod.metadata, uid: undefined } } }
        : each,
    );

    expect(stepRefusal({ member: "catalog-rs-0", primary: false }, members)).toBe(
      "catalog-rs-0 has no pod.",
    );
  });
});

describe("connecting", () => {
  it("opens mongosh with the first user's connection string, read in the shell", () => {
    const command = mongoshCommand(
      set("catalog-rs"),
      "catalog-rs-2",
      connectionOfSet(set("catalog-rs")),
    );

    expect(command).toBe(
      `kubectl exec -it -n mongodb catalog-rs-2 -c mongod -- env HOME=/tmp mongosh "$(kubectl get secret -n mongodb catalog-rs-admin-catalog-admin -o jsonpath='{.data.connectionString\\.standard}' | base64 -d)"`,
    );
  });

  it("gives mongosh the CA the operator mounts when TLS is on", () => {
    expect(mongoshCommand(set("secure-rs"), "secure-rs-0", connectionOfSet(set("secure-rs")))).toBe(
      `kubectl exec -it -n mongodb secure-rs-0 -c mongod -- sh -c 'HOME=/tmp exec mongosh --tlsCAFile /var/lib/tls/ca/*.pem "$@"' mongosh "$(kubectl get secret -n mongodb secure-rs-admin-secure-admin -o jsonpath='{.data.connectionString\\.standard}' | base64 -d)"`,
    );
  });

  it("opens mongosh without credentials when the set declares no user", () => {
    expect(mongoshCommand(set("legacy-rs"), "legacy-rs-0", connectionOfSet(set("legacy-rs")))).toBe(
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
    expect(
      replicaSetCommands(set("catalog-rs"), connectionOfSet(set("catalog-rs"))).map(
        (each) => each.command,
      ),
    ).toContain("kubectl describe mongodbcommunity -n mongodb catalog-rs");
  });

  it("reads every member's agent by label, not a member that may not exist", () => {
    const commands = replicaSetCommands(set("ledger-rs"), undefined);

    expect(
      commands.find((each) => each.label === "What each member's agent is doing")?.command,
    ).toBe("kubectl logs -n mongodb -l app=ledger-rs-svc -c mongodb-agent --prefix --tail=50");
  });

  it("finds the operator by its image, wherever it was installed and however it is named", () => {
    const commands = replicaSetCommands(set("catalog-rs"), undefined);
    const where = commands.find((each) => each.label.startsWith("Where the operator runs"));
    const log = commands.find((each) => each.label.startsWith("The operator's log"));
    const image = /grep -E '(.+)'$/.exec(where?.command ?? "")?.[1] ?? "";
    const operator = pods().find((each) =>
      each.getName().startsWith("mongodb-kubernetes-operator"),
    );
    const images = (pod: unknown) =>
      ((pod as { spec?: { containers?: { image: string }[] } }).spec?.containers ?? []).map(
        (each) => each.image,
      );

    // The fixture's operator matches, and no member's mongod or agent image does.
    expect(images(operator).some((each) => new RegExp(image).test(each))).toBe(true);
    expect(
      memberPodsOf(replicaSets(), pods())
        .flatMap(images)
        .some((each) => new RegExp(image).test(each)),
    ).toBe(false);
    expect(new RegExp(image).test("quay.io/mongodb/mongodb-kubernetes-operator:0.13.0")).toBe(true);
    expect(log?.command).toMatch(/xargs kubectl logs \| grep -F 'mongodb\/catalog-rs'$/);
    expect(log?.command).toContain(`awk '$3 ~ /\\${image}/`);
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

describe("a member left from a scale-down", () => {
  // ledger-rs cut to two: the unschedulable ledger-rs-2 stays behind, no longer a member.
  const ledger = () => {
    const rs = set("ledger-rs");

    return changed(rs, { members: 2 }, { ...rs.status, phase: "Running" });
  };
  const ledgerMembers = () => membersOfSet(ledger());

  it("is the not-ready member the fixture holds, marked extra", () => {
    const left = ledgerMembers().find((each) => each.name === "ledger-rs-2");

    expect(left).toMatchObject({ extra: true, ready: false });
  });

  it("does not hold back Restart all, nor its steps", () => {
    expect(restartAllPlan(ledger(), ledgerMembers())).toEqual({
      steps: [
        { member: "ledger-rs-1", primary: false },
        { member: "ledger-rs-0", primary: true },
      ],
    });
    expect(stepRefusal({ member: "ledger-rs-1", primary: false }, ledgerMembers())).toBeUndefined();
  });

  it("does not keep the set from settling", () => {
    expect(isSettled(ledger(), ledgerMembers())).toBe(true);
  });

  it("is never elected, and its unfinished plan does not hold back a switch", () => {
    const stuck = ledgerMembers().map((each) =>
      each.name === "ledger-rs-2" ? { ...each, inGoalState: false } : each,
    );

    expect(switchRefusal(ledger(), ledgerMembers(), "ledger-rs-2")).toBe(
      "ledger-rs-2 is not a data member.",
    );
    expect(switchRefusal(ledger(), stuck, "ledger-rs-1")).toBeUndefined();
  });

  it("does not count towards the majority a member restart must keep", () => {
    const rs = set("sessions-rs");
    // Cut to one: sessions-rs-1 stays up but no longer votes, so the arbiter alone would be left.
    const smaller = changed(rs, { members: 1 });
    const members = membersOfSet(smaller);

    expect(members.find((each) => each.name === "sessions-rs-1")).toMatchObject({
      extra: true,
      ready: true,
    });
    expect(memberRestartRefusal(smaller, members, "sessions-rs-0")).toBe(
      "Restarting sessions-rs-0 now would leave 1 of 2 members up, short of a majority.",
    );
  });
});

describe("while Restart all runs", () => {
  it("holds every other write to that set's members, and only that set's", async () => {
    const rs = set("catalog-rs");
    const members = membersOfSet(rs);
    const held = /Restart all is still running on catalog-rs/;
    let finish = () => {};
    const running = whileRestartingAll(
      rs,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    expect(restartingRefusal(rs)).toMatch(held);
    expect(memberRestartRefusal(rs, members, "catalog-rs-0")).toMatch(held);
    expect(switchRefusal(rs, members, "catalog-rs-0")).toMatch(held);
    expect(scaleRefusal(rs, 5)).toMatch(held);
    expect(rollingRestartRefusal(rs)).toMatch(held);
    expect(restartAllPlan(rs, members)).toEqual({ refused: expect.stringMatching(held) });
    await expect(whileRestartingAll(rs, async () => "second")).rejects.toThrow(held);
    expect(rollingRestartRefusal(set("sessions-rs"))).toBeUndefined();

    finish();
    await running;

    expect(memberRestartRefusal(rs, members, "catalog-rs-0")).toBeUndefined();
    expect(rollingRestartRefusal(rs)).toBeUndefined();
  });

  it("frees the set when a run stops on an error", async () => {
    const rs = set("catalog-rs");

    await expect(
      whileRestartingAll(rs, async () => {
        throw new Error("Stopped before restarting catalog-rs-1");
      }),
    ).rejects.toThrow("Stopped before");
    expect(restartingRefusal(rs)).toBeUndefined();
    expect(switchRefusal(rs, membersOfSet(rs), "catalog-rs-0")).toBeUndefined();
  });
});

describe("reading the members again", () => {
  it("selects by label exactly a set's member pods, arbiters included", () => {
    for (const rs of replicaSets()) {
      const labelled = pods()
        .filter((pod) => (pod as unknown as KubeObject).getLabels().includes(memberSelector(rs)))
        .map((pod) => pod.getName());

      expect(labelled).toEqual(memberPodsOf([rs], pods()).map((pod) => pod.getName()));
    }
    expect(memberSelector(set("sessions-rs"))).toBe("app=sessions-rs-svc");
  });
});

describe("the scale dialog, as the count is typed", () => {
  const catalog = () => set("catalog-rs");

  it("says why a count is refused, and warns of nothing then", () => {
    expect(scaleAdvice(catalog(), "")).toEqual({
      count: 0,
      refused: "A cluster needs at least one member.",
      warnings: [],
    });
    expect(scaleAdvice(catalog(), "0").warnings).toEqual([]);
    expect(scaleAdvice(catalog(), "two").refused).toBe("A cluster needs at least one member.");
    expect(scaleAdvice(catalog(), "3").refused).toBe("It already has 3 members.");
  });

  it("warns before the write of what an accepted count does", () => {
    const up = scaleAdvice(catalog(), " 4 ");

    expect(up.count).toBe(4);
    expect(up.refused).toBeUndefined();
    expect(up.warnings).toEqual([expect.stringMatching(/^4 voting members can split evenly/)]);
    expect(scaleAdvice(catalog(), "2").warnings).toEqual([
      expect.stringMatching(/^2 voting members can split evenly/),
      "Removes catalog-rs-2; their volumes are kept.",
    ]);
  });
});

describe("checking a write again at OK", () => {
  const catalog = () => set("catalog-rs");

  it("offers Make primary only on a secondary that may ever be primary", () => {
    const rs = catalog();
    const voteless = changed(rs, {
      memberConfig: (rs.spec.memberConfig ?? []).map((each, at) =>
        at === 1 ? { votes: 0, priority: "0" } : each,
      ),
    });
    const offered = (on: ReplicaSetLike) =>
      membersOfSet(on)
        .filter((member) => offersSwitch(on, member))
        .map((member) => member.name);

    expect(offered(rs)).toEqual(["catalog-rs-0", "catalog-rs-1"]);
    expect(offered(voteless)).toEqual(["catalog-rs-0"]);
    expect(offered(set("sessions-rs"))).not.toContain("sessions-rs-arb-0");
  });

  it("refuses a switch whose target became primary while the name was typed", () => {
    const rs = catalog();
    const swapped = membersOfSet(rs).map((each) =>
      each.name === "catalog-rs-0"
        ? { ...each, role: "primary" as const }
        : each.name === "catalog-rs-2"
          ? { ...each, role: "secondary" as const }
          : each,
    );

    expect(switchRefusal(rs, membersOfSet(rs), "catalog-rs-0")).toBeUndefined();
    expect(() => checkedSwitchPatch({ rs, members: swapped }, "catalog-rs-0")).toThrow(
      "catalog-rs-0 is already the primary.",
    );
  });

  it("builds the switch on the set as read at OK, guarded by its resourceVersion", () => {
    const scaled = changed(catalog(), scalePatch(catalog(), 4).spec);
    const patch = checkedSwitchPatch({ rs: scaled, members: membersOfSet(scaled) }, "catalog-rs-0");

    expect(patch.metadata.resourceVersion).toBe(catalog().metadata.resourceVersion);
    expect(patch.spec.memberConfig).toHaveLength(4);
  });

  it("refuses a member restart once another member went down while the name was typed", () => {
    const rs = catalog();
    const members = membersOfSet(rs);
    const oneDown = members.map((each) =>
      each.name === "catalog-rs-1" ? { ...each, ready: false } : each,
    );

    expect(() => checkMemberRestart({ rs, members }, "catalog-rs-0")).not.toThrow();
    expect(() => checkMemberRestart({ rs, members: oneDown }, "catalog-rs-0")).toThrow(
      /short of a majority/,
    );
  });
});

describe("choosing whom a switch elects", () => {
  const catalog = () => set("catalog-rs");

  it("takes the first member that can be elected, and offers every one that can", () => {
    const rs = catalog();

    expect(switchTarget(rs, membersOfSet(rs))).toEqual({
      target: "catalog-rs-0",
      candidates: ["catalog-rs-0", "catalog-rs-1"],
    });
    expect(switchTarget(rs, membersOfSet(rs), "catalog-rs-2")).toEqual({
      refused: "catalog-rs-2 is already the primary.",
    });
  });

  it("names why no member can be elected instead of a nameless refusal", () => {
    const ledger = set("ledger-rs");
    const secure = set("secure-rs");

    expect(switchTarget(ledger, membersOfSet(ledger))).toEqual({
      refused: "Only a running cluster can elect a new primary.",
    });
    expect(switchTarget(secure, membersOfSet(secure))).toEqual({
      refused: "It has no other data member to elect.",
    });
  });
});

describe("where mongosh opens from the title bar", () => {
  it("is the primary, else a ready data member, else nowhere", () => {
    const rs = set("catalog-rs");

    expect(mongoshTarget(membersOfSet(rs))).toBe("catalog-rs-2");
    expect(mongoshTarget(membersOf(rs, pods(), pvcs(), {}))).toBe("catalog-rs-0");
    expect(mongoshTarget(membersOfSet(set("legacy-rs")))).toBeUndefined();
  });
});

describe("a connection Secret that does not exist", () => {
  const catalog = () => set("catalog-rs");
  const withUser = (user: Partial<NonNullable<ReplicaSetLike["spec"]["users"]>[number]>) => {
    const rs = catalog();
    const [first] = rs.spec.users ?? [];

    return changed(rs, { users: first ? [{ ...first, ...user }] : [] });
  };

  it("is not read by mongosh or offered as a command", () => {
    const rs = withUser({ connectionStringSecretName: "catalog-connection" });
    const connection = connectionOfSet(rs);

    expect(usersOf(rs, secrets())[0]?.connectionExists).toBe(false);
    expect(connection).toBeUndefined();
    expect(mongoshCommand(rs, "catalog-rs-2", connection)).toBe(
      "kubectl exec -it -n mongodb catalog-rs-2 -c mongod -- env HOME=/tmp mongosh",
    );
    expect(replicaSetCommands(rs, connection).map((each) => each.label)).not.toContain(
      "The full connection string, with the password",
    );
  });

  it("is assumed present until its namespace is listed, and read from the namespace the user names", () => {
    const rs = withUser({ connectionStringSecretNamespace: "apps" });
    const connection = connectionOf(usersOf(rs, secrets()));

    expect(connection).toEqual({ namespace: "apps", name: "catalog-rs-admin-catalog-admin" });
    expect(replicaSetCommands(rs, connection).map((each) => each.command)).toContain(
      "kubectl get secret -n apps catalog-rs-admin-catalog-admin -o jsonpath='{.data.connectionString\\.standard}' | base64 -d",
    );
    expect(usersOf(catalog(), secrets())[0]?.connectionExists).toBe(true);
  });

  it("is named as the operator normalises it", () => {
    const rs = catalog();
    const [user] = rs.spec.users ?? [];

    expect(user && connectionSecretOf(rs, { ...user, name: "Report_User" })).toBe(
      "catalog-rs-admin-report-user",
    );
    expect(user && connectionSecretOf(rs, { ...user, name: "app.reader" })).toBe(
      "catalog-rs-admin-app.reader",
    );
    expect(user && connectionSecretOf(rs, { ...user, name: "__Ops__" })).toBe(
      "catalog-rs-admin-ops",
    );
  });
});
