import { describe, expect, it } from "vitest";
import type { Application } from "../src/renderer/api/application";
import {
  applyToEachApplication,
  type BulkOutcome,
  describeOutcome,
  listNames,
  refreshEach,
  syncEach,
} from "../src/renderer/api/bulk";
import { applications } from "./fixtures";

function recordingAction(calledWith: string[]) {
  return async (application: Application) => {
    calledWith.push(application.getName());
  };
}

function actionFailingFor(namesThatFail: string[]) {
  return async (application: Application) => {
    if (namesThatFail.includes(application.getName())) {
      throw new Error(`the API server rejected ${application.getName()}`);
    }
  };
}

describe("applying an action to every Application", () => {
  it("attempts each Application exactly once", async () => {
    const targets = applications().slice(0, 10);
    const attempted: string[] = [];

    const outcome = await applyToEachApplication(targets, recordingAction(attempted));

    expect(outcome.succeeded).toBe(targets.length);
    expect(outcome.failures).toEqual([]);
    expect(attempted.sort()).toEqual(targets.map((target) => target.getName()).sort());
  });

  it("never exceeds the concurrency limit, and still finishes every one", async () => {
    const targets = applications().slice(0, 12);
    let currentlyInFlight = 0;
    let peakInFlight = 0;
    const completed: string[] = [];

    await applyToEachApplication(targets, async (application) => {
      currentlyInFlight += 1;
      peakInFlight = Math.max(peakInFlight, currentlyInFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      currentlyInFlight -= 1;
      completed.push(application.getName());
    });

    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(4);
    expect(completed).toHaveLength(targets.length);
  });

  it("waits for every action to settle before reporting", async () => {
    const targets = applications().slice(0, 6);
    let stillRunning = 0;

    await applyToEachApplication(targets, async () => {
      stillRunning += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      stillRunning -= 1;
    });

    expect(stillRunning).toBe(0);
  });
});

describe("applying an action when some of them fail", () => {
  it("carries on past a failure and names the one that failed", async () => {
    const targets = applications().slice(0, 6);
    const doomedName = targets[2]?.getName() as string;

    const outcome = await applyToEachApplication(targets, actionFailingFor([doomedName]));

    expect(outcome.succeeded).toBe(targets.length - 1);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.applicationName).toBe(doomedName);
    expect(outcome.failures[0]?.reason).toContain("rejected");
  });

  it("keeps attempting the rest after the very first one fails", async () => {
    const targets = applications().slice(0, 8);
    const firstName = targets[0]?.getName() as string;
    const attempted: string[] = [];

    const outcome = await applyToEachApplication(targets, async (application) => {
      attempted.push(application.getName());

      if (application.getName() === firstName) throw new Error("no");
    });

    expect(attempted).toHaveLength(targets.length);
    expect(outcome.succeeded).toBe(targets.length - 1);
  });

  it("reports every failure when they all fail", async () => {
    const targets = applications().slice(0, 5);
    const everyName = targets.map((target) => target.getName());

    const outcome = await applyToEachApplication(targets, actionFailingFor(everyName));

    expect(outcome.succeeded).toBe(0);
    expect(outcome.failures.map((failure) => failure.applicationName).sort()).toEqual(
      [...everyName].sort(),
    );
  });
});

describe("applying an action to a set that makes no sense", () => {
  it("does nothing, successfully, for an empty set", async () => {
    let wasCalled = false;

    const outcome = await applyToEachApplication([], async () => {
      wasCalled = true;
    });

    expect(wasCalled).toBe(false);
    expect(outcome).toEqual({ succeeded: 0, failures: [] });
  });

  it("reports a rejection that is not an Error without printing [object Object]", async () => {
    const targets = applications().slice(0, 1);

    const outcome = await applyToEachApplication(targets, () =>
      Promise.reject("the API server closed the connection"),
    );

    expect(outcome.failures[0]?.reason).toBe("the API server closed the connection");
  });

  it("turns an action that cannot be issued at all into named failures", async () => {
    // No registered extension means no API; that must come back as a named failure, not a throw.
    const targets = applications().slice(0, 3);
    const outcome = await refreshEach(targets);

    expect(outcome.succeeded).toBe(0);
    expect(outcome.failures.map((failure) => failure.applicationName).sort()).toEqual(
      targets.map((target) => target.getName()).sort(),
    );
  });

  it("does the same for a sync, a hard refresh, and a sync with prune", async () => {
    const targets = applications().slice(0, 2);

    expect((await syncEach(targets)).failures).toHaveLength(2);
    expect((await syncEach(targets, { prune: true })).failures).toHaveLength(2);
    expect((await refreshEach(targets, "hard")).failures).toHaveLength(2);
  });
});

describe("describing what happened", () => {
  const outcomeWith = (succeeded: number, failedNames: string[]): BulkOutcome => ({
    succeeded,
    failures: failedNames.map((applicationName) => ({ applicationName, reason: "no" })),
  });

  it("says the plain thing when everything worked", () => {
    expect(describeOutcome("Refreshed", outcomeWith(5, []))).toBe("Refreshed 5 Applications.");
  });

  it("gets the singular right", () => {
    expect(describeOutcome("Refreshed", outcomeWith(1, []))).toBe("Refreshed 1 Application.");
  });

  it("names a small number of failures in full, with no ellipsis", () => {
    const sentence = describeOutcome("Synced", outcomeWith(1, ["alpha"]));

    expect(sentence).toBe("Synced 1, failed on 1: alpha");
    expect(sentence).not.toContain("…");
  });

  it("names the first three and trails off when there are more", () => {
    const sentence = describeOutcome(
      "Synced",
      outcomeWith(3, ["alpha", "beta", "gamma", "delta", "epsilon"]),
    );

    expect(sentence).toContain("Synced 3");
    expect(sentence).toContain("failed on 5");
    expect(sentence).toContain("alpha, beta, gamma");
    expect(sentence).not.toContain("delta");
    expect(sentence).toContain("…");
  });

  it("reports zero successes without claiming any", () => {
    expect(describeOutcome("Synced", outcomeWith(0, ["alpha"]))).toBe(
      "Synced 0, failed on 1: alpha",
    );
  });
});

describe("listNames", () => {
  it("says nothing for nobody and the one name for one", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["alpha"])).toBe("alpha");
  });

  it("joins the last name with 'and'", () => {
    expect(listNames(["alpha", "beta", "gamma"])).toBe("alpha, beta and gamma");
  });

  it("names the first few and counts the rest", () => {
    expect(listNames(["a", "b", "c", "d", "e"], 2)).toBe("a, b and 3 more");
  });
});
