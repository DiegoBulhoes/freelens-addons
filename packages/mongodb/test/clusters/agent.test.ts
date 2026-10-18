import { describe, expect, it } from "vitest";

import {
  afterAgentRead,
  agentKeys,
  agentsError,
  agentViewOf,
  KEPT_VIEW_MS,
  stuckAt,
} from "../../src/renderer/api/clusters/agent";
import type { AgentHealth } from "../../src/renderer/api/shared/types";
import { execOutput } from "../../src/renderer/api/writes/exec";
import { healthOf, pods } from "../support/fixtures";

describe("reading a member's agent", () => {
  it("names the primary, the secondaries and the arbiter by their replication state", () => {
    // Which data member is primary changes with every restart; one of each is what holds.
    const roles = ["sessions-rs-0", "secure-rs-0"].map(
      (pod) => agentViewOf(healthOf(pod), pod)?.role,
    );

    expect(roles.sort()).toEqual(["primary", "secondary"]);
    expect(agentViewOf(healthOf("sessions-rs-arb-0"), "sessions-rs-arb-0")?.role).toBe("arbiter");
  });

  it("says mongod is not running, and why the agent is stuck, for a member short of its goal", () => {
    const view = agentViewOf(healthOf("upgrade-rs-1"), "upgrade-rs-1");

    expect(view?.role).toBe("not running");
    expect(view?.inGoalState).toBe(false);
    expect(view?.stuck).toMatch(
      /Start a mongo instance \(start fresh\): the agent's last attempt failed/,
    );
  });

  it("gives no cause for a member at its goal, even when an unfinished plan with a failed step is its newest", () => {
    const health = healthOf("ledger-rs-0");
    const plans = health.mmsStatus?.["ledger-rs-0"]?.plans ?? [];
    const failedUnfinished = plans.filter(
      (plan) =>
        !plan.completed &&
        plan.moves?.some((move) => move.steps?.some((step) => step.result === "error")),
    );

    expect(failedUnfinished.length).toBeGreaterThan(0);

    const reordered = {
      ...health,
      mmsStatus: {
        "ledger-rs-0": { ...health.mmsStatus?.["ledger-rs-0"], plans: failedUnfinished },
      },
    };

    expect(stuckAt(failedUnfinished)).toMatch(/failed/);
    expect(agentViewOf(reordered, "ledger-rs-0")?.stuck).toBeUndefined();
  });

  it("has nothing to say of a pod the file does not describe", () => {
    expect(agentViewOf(healthOf("catalog-rs-0"), "catalog-rs-1")).toBeUndefined();
    expect(agentViewOf(undefined, "catalog-rs-0")).toBeUndefined();
  });

  it("reads an unknown replication state as unknown", () => {
    const health: AgentHealth = { statuses: { x: { ReplicationStatus: 42, IsInGoalState: true } } };

    expect(agentViewOf(health, "x")?.role).toBe("unknown");
  });
});

describe("finding where a plan is stuck", () => {
  it("names the step that is waiting when none failed", () => {
    expect(
      stuckAt([
        {
          moves: [
            {
              move: "WaitAllRsMembersUp",
              steps: [
                {
                  step: "WaitAllRsMembersUp",
                  stepDoc: "Wait until all members  are up",
                  started: "t",
                  completed: null,
                },
              ],
            },
          ],
        },
      ]),
    ).toBe("Wait until all members are up: waiting.");
  });

  it("finds nothing in a completed plan, an empty one, or none", () => {
    expect(stuckAt([{ completed: "t", moves: [] }])).toBeUndefined();
    expect(stuckAt([{ moves: [{ move: "m", steps: [{ step: "s" }] }] }])).toBeUndefined();
    expect(stuckAt(null)).toBeUndefined();
  });

  it("falls back to the step's name when it has no description", () => {
    expect(
      stuckAt([{ moves: [{ move: "m", steps: [{ step: "RsInit", result: "error" }] }] }]),
    ).toBe("RsInit: the agent's last attempt failed.");
  });
});

describe("decoding exec frames", () => {
  const frame = (channel: number, text: string) =>
    Uint8Array.from([channel, ...new TextEncoder().encode(text)]);

  it("joins stdout and ignores stderr", () => {
    expect(execOutput([frame(1, '{"a":'), frame(2, "noise"), frame(1, "1}")])).toEqual({
      stdout: '{"a":1}',
      error: undefined,
    });
  });

  it("reports a failed command from the status channel", () => {
    expect(
      execOutput([frame(3, JSON.stringify({ status: "Failure", message: "container not found" }))])
        .error,
    ).toBe("container not found");
    expect(execOutput([frame(3, JSON.stringify({ status: "Failure" }))]).error).toBe(
      "the command failed",
    );
    expect(
      execOutput([frame(3, JSON.stringify({ status: "Success" })), frame(3, "")]).error,
    ).toBeUndefined();
  });
});

describe("choosing whose agent to read", () => {
  it("takes pods whose agent runs, even when mongod cannot start", () => {
    const keys = agentKeys(pods());

    expect(keys).toContain("mongodb/upgrade-rs-1");
    expect(keys).toContain("mongodb/sessions-rs-arb-0");
    expect(keys).not.toContain("mongodb/legacy-rs-0");
    expect(keys.some((key) => key.includes("operator"))).toBe(false);
  });
});

describe("re-reading an agent", () => {
  const view = agentViewOf(healthOf("sessions-rs-arb-0"), "sessions-rs-arb-0");

  it("keeps the last view through a failed read, marked failed", () => {
    const read = afterAgentRead(undefined, 1, { view });
    const lost = afterAgentRead(read, 2, { failed: "sessions-rs-arb-0 did not answer within 10s" });

    expect(lost).toEqual({
      at: 2,
      view,
      failed: "sessions-rs-arb-0 did not answer within 10s",
      failedSince: 2,
    });
    expect(afterAgentRead(lost, 3, { view })).toEqual({ at: 3, view });
    expect(afterAgentRead(undefined, 1, { failed: "refused" }).view).toBeUndefined();
  });

  it("drops the kept view once reads have failed for longer than KEPT_VIEW_MS", () => {
    const read = afterAgentRead(undefined, 0, { view });
    const first = afterAgentRead(read, 1, { failed: "x" });
    const still = afterAgentRead(first, KEPT_VIEW_MS, { failed: "x" });
    const expired = afterAgentRead(still, 1 + KEPT_VIEW_MS, { failed: "x" });

    expect(still.view).toEqual(view);
    expect(expired.view).toBeUndefined();
    expect(expired.failedSince).toBe(1);
    expect(afterAgentRead(expired, 2 + KEPT_VIEW_MS, { view }).view).toEqual(view);
  });

  it("reports an error only when no agent answered", () => {
    const lost = afterAgentRead(undefined, 1, { failed: "refused" });

    expect(agentsError([lost, afterAgentRead(undefined, 1, { view })])).toBeUndefined();
    expect(agentsError([lost, lost])).toBe("refused");
    expect(agentsError([])).toBeUndefined();
  });
});
