import { describe, expect, it } from "vitest";
import {
  dataMembers,
  isReady,
  membersOf,
  preferredOf,
  primaryOf,
  readyCount,
} from "../src/renderer/api/members";
import { agentsOf } from "../src/renderer/api/rows";
import { agents, named, pods, pvcs, replicaSets } from "./fixtures";

const membersOfSet = (name: string) => {
  const rs = named(replicaSets(), name);

  return { rs, members: membersOf(rs, pods(), pvcs(), agentsOf(rs, agents())) };
};

describe("listing a cluster's members", () => {
  it("puts data members before arbiters, with each one's role from its agent", () => {
    const { members } = membersOfSet("sessions-rs");

    expect(members.map((each) => [each.name, each.arbiter])).toEqual([
      ["sessions-rs-0", false],
      ["sessions-rs-1", false],
      ["sessions-rs-arb-0", true],
    ]);
    expect(
      dataMembers(members)
        .map((each) => each.role)
        .sort(),
    ).toEqual(["primary", "secondary"]);
    expect(members.at(-1)?.role).toBe("arbiter");
    expect(primaryOf(members)?.role).toBe("primary");
    expect(dataMembers(members).map((each) => each.name)).toEqual([
      "sessions-rs-0",
      "sessions-rs-1",
    ]);
  });

  it("carries node, volume size and readiness", () => {
    const [first] = membersOfSet("catalog-rs").members;

    expect(first?.ready).toBe(true);
    expect(first?.node).toBeTruthy();
    expect(first?.volume).toMatch(/G/);
    expect(first?.problem).toBeUndefined();
  });

  it("takes uptime from the mongod container's start, and has none while it does not run", () => {
    const [first] = membersOfSet("catalog-rs").members;
    const pod = named(pods(), "catalog-rs-0");
    const started = pod.status?.containerStatuses?.find((each) => each.name === "mongod")?.state
      ?.running?.startedAt;

    expect(started).toMatch(/^\d{4}-/);
    expect(first?.upSince).toBe(started);
    expect(membersOfSet("upgrade-rs").members[0]?.upSince).toBeUndefined();
  });

  it("names the member a raised priority prefers, and none when priorities are equal", () => {
    const catalog = membersOfSet("catalog-rs");

    expect(preferredOf(catalog.members)?.name).toBe("catalog-rs-2");
    expect(catalog.members.map((each) => each.priority)).toEqual([1, 1, 2]);
    expect(preferredOf(membersOfSet("sessions-rs").members)).toBeUndefined();
    expect(preferredOf(membersOfSet("secure-rs").members)).toBeUndefined();
  });

  it("explains a member whose volume is not bound", () => {
    const [member] = membersOfSet("legacy-rs").members;

    expect(member?.ready).toBe(false);
    expect(member?.problem).toMatch(
      /data-volume-legacy-rs-0 is not bound \(storage class no-such-class\)/,
    );
  });

  it("explains a member whose image cannot be pulled", () => {
    const [member] = membersOfSet("upgrade-rs").members;

    expect(member?.problem).toMatch(/^mongod: ImagePullBackOff, .*8\.0\.999/);
  });

  it("lists the members it should have even before their pods exist", () => {
    const { rs, members } = membersOfSet("reporting-rs");

    expect(members.map((each) => each.name)).toEqual(["reporting-rs-0"]);
    expect(members[0]?.problem).toBe("It has no pod yet.");
    expect(readyCount(rs, members)).toEqual({ ready: 0, wanted: 1 });
  });

  it("keeps a pod left from a scale-down, marked extra", () => {
    const rs = named(replicaSets(), "sessions-rs");
    const smaller = {
      ...rs,
      getName: () => rs.getName(),
      getNs: () => rs.getNs(),
      spec: { ...rs.spec, members: 1 },
    };
    const members = membersOf(smaller, pods(), pvcs(), {});

    expect(members.find((each) => each.name === "sessions-rs-1")?.extra).toBe(true);
    expect(readyCount(smaller, members)).toEqual({ ready: 2, wanted: 2 });
  });

  it("reads an arbiter's role from its pod when its agent could not be read", () => {
    const rs = named(replicaSets(), "sessions-rs");
    const members = membersOf(rs, pods(), pvcs(), {});

    expect(members.find((each) => each.arbiter)?.role).toBe("arbiter");
    expect(members.find((each) => !each.arbiter)?.role).toBeUndefined();
  });

  it("is not ready without a pod or a Ready condition", () => {
    expect(isReady(undefined)).toBe(false);
    expect(isReady(named(pods(), "upgrade-rs-0"))).toBe(false);
  });

  it("says which step a ready member's agent is on while it applies a change", () => {
    const rs = named(replicaSets(), "sessions-rs");
    const waiting = {
      role: "secondary" as const,
      inGoalState: false,
      stuck: "Wait until the primary is up: waiting.",
    };
    const members = membersOf(rs, pods(), pvcs(), { "sessions-rs-1": waiting });

    expect(members.find((each) => each.name === "sessions-rs-1")).toMatchObject({
      applying: "Wait until the primary is up: waiting.",
      problem: undefined,
    });
    expect(membersOfSet("catalog-rs").members.every((each) => each.applying === undefined)).toBe(
      true,
    );
    expect(membersOfSet("upgrade-rs").members[0]?.applying).toBeUndefined();
  });
});
