import { describe, expect, it } from "vitest";

import { membersOf } from "../src/renderer/api/members";
import {
  isChangingVersion,
  replicaSetHealth,
  runningVersion,
  versionLabel,
} from "../src/renderer/api/replica-sets";
import { agentsOf } from "../src/renderer/api/rows";
import type { ReplicaSetLike } from "../src/renderer/api/types";
import { agents, named, pods, pvcs, replicaSets } from "./fixtures";

const health = (rs: ReplicaSetLike, withAgents = true) =>
  replicaSetHealth(rs, membersOf(rs, pods(), pvcs(), withAgents ? agentsOf(rs, agents()) : {}));

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

describe("judging a cluster", () => {
  it("calls a running set with every member up and a primary healthy", () => {
    expect(health(named(replicaSets(), "catalog-rs"))).toMatchObject({
      tone: "ok",
      label: "Healthy",
    });
    expect(health(named(replicaSets(), "sessions-rs")).reason).toBe("3 of 3 members ready.");
  });

  it("gives the operator's own message for a failed set", () => {
    expect(health(named(replicaSets(), "reporting-rs"))).toMatchObject({
      tone: "critical",
      label: "Failed",
      reason: expect.stringMatching(/reporting-password/),
    });
  });

  it("names the concrete cause of a set that is down, not the operator's retrying", () => {
    expect(health(named(replicaSets(), "legacy-rs"))).toMatchObject({
      tone: "critical",
      label: "Down",
      reason: expect.stringMatching(/not bound/),
    });
    expect(health(named(replicaSets(), "upgrade-rs")).reason).toMatch(/ImagePullBackOff/);
  });

  it("says a version change is under way while the set is not yet running it", () => {
    const rs = named(replicaSets(), "sessions-rs");
    const upgrading = changed(rs, { version: "8.0.12" }, { ...rs.status, phase: "Pending" });

    expect(health(upgrading)).toMatchObject({
      tone: "warning",
      label: "Changing version",
      reason: expect.stringMatching(/Asked for 8\.0\.12, still on 7\.0\.21/),
    });
  });

  it("calls a set missing a member degraded", () => {
    const rs = named(replicaSets(), "sessions-rs");
    const wider = changed(rs, { members: 3 });

    expect(health(wider)).toMatchObject({ tone: "warning", label: "Degraded" });
    expect(health(wider).reason).toMatch(/^3 of 4 members ready\. It has no pod yet\.$/);
  });

  it("calls a set with every member up but no primary critical", () => {
    const rs = named(replicaSets(), "catalog-rs");
    const members = membersOf(rs, pods(), pvcs(), agentsOf(rs, agents())).map((each) => ({
      ...each,
      role: "secondary" as const,
    }));

    expect(replicaSetHealth(rs, members).label).toBe("No primary");
  });

  it("does not claim a missing primary when no agent could be read", () => {
    expect(health(named(replicaSets(), "catalog-rs"), false).label).toBe("Healthy");
  });

  it("passes on a phase it does not know, as information", () => {
    const rs = named(replicaSets(), "catalog-rs");

    expect(health(changed(rs, {}, { ...rs.status, phase: "Scaling" }))).toMatchObject({
      tone: "info",
      label: "Scaling",
    });
  });
});

describe("its version", () => {
  it("is the reached one, else the operator's last applied, else unknown", () => {
    const rs = named(replicaSets(), "catalog-rs");

    expect(runningVersion(rs)).toBe("8.0.12");
    expect(runningVersion(changed(rs, {}, { phase: "Pending" }))).toBe("8.0.12");
    expect(runningVersion(named(replicaSets(), "upgrade-rs"))).toBeUndefined();
  });

  it("shows where it is going and its pinned feature compatibility", () => {
    const rs = named(replicaSets(), "sessions-rs");

    expect(versionLabel(rs)).toBe("7.0.21");
    expect(isChangingVersion(rs)).toBe(false);
    expect(
      versionLabel(changed(rs, { version: "8.0.12", featureCompatibilityVersion: "7.0" })),
    ).toBe("7.0.21 → 8.0.12 (FCV 7.0)");
    expect(versionLabel(named(replicaSets(), "upgrade-rs"))).toBe("— → 8.0.999");
  });
});
