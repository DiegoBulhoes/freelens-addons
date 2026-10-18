import { describe, expect, it } from "vitest";
import type { Application } from "../../src/renderer/api/applications/application";
import { AppProject } from "../../src/renderer/api/projects/app-project";
import { frozenWindows } from "../../src/renderer/api/projects/freeze";
import {
  applyToEachApplication,
  type BulkOutcome,
  describeBulkOutcome,
  describeOutcome,
  describeRefresh,
  failureOf,
  listNames,
  planFor,
  projectRefusal,
  refreshEach,
  syncEach,
} from "../../src/renderer/api/writes/bulk";
import {
  applications,
  appProject,
  appProjects,
  projectVariantOf,
  statusOf,
  variantOf,
} from "../support/fixtures";

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
    expect(describeBulkOutcome("Refreshed", outcomeWith(5, []))).toBe("Refreshed 5 Applications.");
  });

  it("gets the singular right", () => {
    expect(describeBulkOutcome("Refreshed", outcomeWith(1, []))).toBe("Refreshed 1 Application.");
  });

  it("names a small number of failures in full, with no ellipsis", () => {
    const sentence = describeBulkOutcome("Synced", outcomeWith(1, ["alpha"]));

    expect(sentence).toBe("Synced 1, failed on 1: alpha");
    expect(sentence).not.toContain("…");
  });

  it("names the first three and trails off when there are more", () => {
    const sentence = describeBulkOutcome(
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
    expect(describeBulkOutcome("Synced", outcomeWith(0, ["alpha"]))).toBe(
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

describe("planning a bulk action", () => {
  it("splits the selection into what it applies to and what it skips, with why", () => {
    const targets = applications().slice(0, 4);
    const refused = targets[1]?.getName();
    const plan = planFor(targets, (application) =>
      application.getName() === refused ? "not this one" : undefined,
    );

    expect(plan.ready.map((each) => each.getName())).toEqual(
      targets.filter((each) => each.getName() !== refused).map((each) => each.getName()),
    );
    expect(plan.skipped.map(({ item, reason }) => [item.getName(), reason])).toEqual([
      [refused, "not this one"],
    ]);
  });

  it("reports how many were done, and names those that failed", () => {
    expect(describeOutcome("Deleted", 2, [])).toBe("Deleted 2 of 2.");
    expect(describeOutcome("Deleted", 1, ["podinfo-chart"])).toBe(
      "Deleted 1 of 2. Failed: podinfo-chart.",
    );
  });

  it("keeps why each item failed, apart from the names inside it", () => {
    const failed = [
      failureOf("demo", new Error("guestbook, helm-guestbook (operation running)")),
      failureOf("default", "forbidden"),
    ];

    expect(failed).toEqual([
      "demo (guestbook, helm-guestbook (operation running))",
      "default (forbidden)",
    ]);
    expect(describeOutcome("Synced", 0, failed)).toBe(
      "Synced 0 of 2. Failed: demo (guestbook, helm-guestbook (operation running)); default (forbidden).",
    );
  });
});

describe("which projects a bulk action skips", () => {
  const frozen = () =>
    projectVariantOf("demo", (data) => {
      data.spec.syncWindows = frozenWindows([]);
    });
  const counted = (project: AppProject) =>
    AppProject.selectApplications(project, applications()).length;

  it("freezes only what is not frozen yet, and resumes only what is", () => {
    const [project] = appProjects();

    expect(projectRefusal("freeze", counted)(project as AppProject)).toBeUndefined();
    expect(projectRefusal("freeze", counted)(frozen())).toBe("already frozen");
    expect(projectRefusal("resume", counted)(frozen())).toBeUndefined();
    expect(projectRefusal("resume", counted)(project as AppProject)).toBe("not frozen");
  });

  it("refreshes and syncs only projects that have Applications", () => {
    const projects = appProjects();
    const withApplications = projects.filter((project) => counted(project) > 0);

    expect(withApplications.length).toBeGreaterThan(0);

    for (const action of ["refresh", "sync"] as const) {
      const plan = planFor(projects, projectRefusal(action, counted));

      expect(plan.ready).toEqual(withApplications);
      expect(plan.skipped.every(({ reason }) => reason === "it has no Applications")).toBe(true);
    }

    expect(projectRefusal("sync", () => 0)(projects[0] as AppProject)).toBe(
      "it has no Applications",
    );
  });
});

describe("a bulk sync and Applications already running an operation", () => {
  const running = variantOf("guestbook", (data) => {
    (statusOf(data).operationState as Record<string, unknown>).phase = "Running";
  });

  it("skips them, with why, instead of overwriting their operation", async () => {
    const idle = applications().find((each) => each.getName() === "podinfo");
    if (!idle) throw new Error("no podinfo in the fixtures");

    const outcome = await syncEach([running, idle]);

    // The idle one is attempted and fails only because no API is registered under test.
    expect(outcome.failures.map((failure) => failure.applicationName)).toEqual(["podinfo"]);
    expect(outcome.skipped).toEqual([
      {
        applicationName: "guestbook",
        reason: "guestbook already has an operation running. Wait for it, or terminate it.",
      },
    ]);
  });

  it("names the skipped ones after what was done", () => {
    const skipped = [{ applicationName: "guestbook", reason: "busy" }];

    expect(describeBulkOutcome("Started a sync on", { succeeded: 2, failures: [], skipped })).toBe(
      "Started a sync on 2 Applications. Skipped 1 with an operation already running: guestbook.",
    );
    expect(
      describeBulkOutcome("Started a sync on", {
        succeeded: 0,
        failures: [{ applicationName: "podinfo", reason: "no" }],
        skipped,
      }),
    ).toBe(
      "Started a sync on 0, failed on 1: podinfo. Skipped 1 with an operation already running: guestbook.",
    );
  });
});

describe("asking before a refresh", () => {
  it("names the one Application and says nothing in the cluster changes", () => {
    expect(describeRefresh(["guestbook"], "normal")).toEqual({
      question: "Refresh guestbook?",
      detail: "ArgoCD compares it with git again. Nothing in the cluster changes.",
      label: "Refresh",
    });
  });

  it("says a hard refresh also regenerates the manifests", () => {
    const { question, detail, label } = describeRefresh(["guestbook"], "hard");

    expect(question).toBe("Hard refresh guestbook?");
    expect(detail).toMatch(/drops the manifests it cached, generates them again/);
    expect(label).toBe("Hard refresh");
  });

  it("counts and lists the ticked Applications", () => {
    const names = applications()
      .slice(0, 3)
      .map((each) => each.getName());
    const { question, detail, label } = describeRefresh(names, "normal");

    expect(question).toBe("Refresh the 3 selected Applications?");
    expect(detail).toBe(
      `${listNames(names)}. ArgoCD compares each one with git again. Nothing in the cluster changes.`,
    );
    expect(label).toBe("Refresh 3");
  });
});

describe("a project's own menu", () => {
  const governed = (project: AppProject) =>
    AppProject.selectApplications(project, applications()).length;

  it("offers no Refresh all or Sync all for a project with no Applications", () => {
    expect(projectRefusal("sync", governed)(appProject("restricted"))).toBe(
      "it has no Applications",
    );
    expect(projectRefusal("sync", governed)(appProject("demo"))).toBeUndefined();
  });
});
