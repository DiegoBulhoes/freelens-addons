import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { clickUntilDialog, clickWhenShown, openWorkbench } from "../../../../build/e2e/freelens";
import {
  clickUndo,
  confirmDialog,
  type KubeObject,
  notificationMatching,
  putBackWith,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { APPS, argocdWrites, FROZEN } from "../support/writes";

// Each test leaves the Applications, projects and rules as the seed made them: synced where they
// were, no sync window, the rules' images and settings unchanged. Its putBack puts the
// seed back even when an assertion fails half-way, and afterAll thaws every project it froze.
describe("ArgoCD writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;
  const putBack = putBackWith(onTestFinished);

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  const {
    js,
    app,
    project,
    frozen,
    reconciledSince,
    unfreeze,
    untickAll,
    barDialog,
    restoreHelmGuestbookDrift,
    hostRow,
    showProjects,
    appMenu,
    projectMenu,
    thawAndClose,
  } = argocdWrites(() => ({ session, frame }));

  afterAll(thawAndClose);

  it("refreshes every Application of the default project from its menu", async () => {
    const since = Date.now();

    await projectMenu("default", "Refresh all");
    await confirmDialog(session, frame, "Refresh");
    await notificationMatching(session, frame, /Requested a refresh of 2 Applications/);

    for (const name of ["example.kustomize-guestbook", "example.sync-waves"]) {
      await untilCluster(`${name} compared again`, () => reconciledSince(name, since));
    }
  });

  it("freezes the default project, and Undo resumes it", async () => {
    putBack(unfreeze("default"));
    await projectMenu("default", "Freeze deploys");
    await confirmDialog(session, frame, "Freeze");
    await notificationMatching(session, frame, /Froze deploys for default/);
    expect(await frozen("default")).toBe(true);

    await clickUndo(session, frame, /Froze deploys for default/, /Resumed deploys for default/);
    expect(await frozen("default")).toBe(false);
  });

  it("freezes demo, holds a sync of helm-guestbook, terminates it, and resumes demo", async () => {
    // One handler, in order: a held sync still running would deploy as soon as demo thaws.
    putBack(async () => {
      if ((await app("helm-guestbook"))?.status?.operationState?.phase === "Running") {
        await restore(session, frame, "PATCH", `${APPS}/helm-guestbook`, {
          status: { operationState: { phase: "Terminating" } },
        });
        await untilCluster(
          "the held sync stopped",
          async () => (await app("helm-guestbook"))?.status?.operationState?.phase !== "Running",
        );
      }
      await unfreeze("demo")();
      await restoreHelmGuestbookDrift();
    });
    await projectMenu("demo", "Freeze deploys");
    await confirmDialog(session, frame, "Freeze");
    await notificationMatching(session, frame, /Froze deploys for demo/);
    expect(await frozen("demo")).toBe(true);

    await appMenu("helm-guestbook", "Sync");
    const dialog = await confirmDialog(session, frame, "Sync");
    expect(dialog).toMatch(/Its project demo is frozen/);
    await notificationMatching(
      session,
      frame,
      /Sync of helm-guestbook requested; it waits until demo is resumed/,
    );
    await untilCluster(
      "the sync held",
      async () => (await app("helm-guestbook"))?.status?.operationState?.phase === "Running",
    );

    await appMenu("helm-guestbook", "Terminate sync");
    await confirmDialog(session, frame, "Terminate");
    await notificationMatching(session, frame, /Terminated the running sync on helm-guestbook/);
    await untilCluster("the sync terminated", async () =>
      ["Terminating", "Failed"].includes(
        (await app("helm-guestbook"))?.status?.operationState?.phase,
      ),
    );

    await projectMenu("demo", "Resume deploys");
    await confirmDialog(session, frame, "Resume");
    await notificationMatching(session, frame, /Resumed deploys for demo/);
    expect(await frozen("demo")).toBe(false);
    expect((await project("demo"))?.spec?.syncWindows ?? []).toEqual([]);
  });

  it("refreshes, freezes and resumes the ticked default project from the projects list", async () => {
    putBack(async () => {
      await untickAll(".ArgoCDAppProjects");
      await unfreeze("default")();
    });
    await showProjects();
    await js(
      `${hostRow(".ArgoCDAppProjects", "default")}.querySelector(".TableCell.checkbox").click()`,
    );

    const since = Date.now();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Refresh all");
    await confirmDialog(session, frame, "Refresh 1");
    await notificationMatching(session, frame, /Refreshed 1 of 1/);
    await untilCluster("example.sync-waves compared again", () =>
      reconciledSince("example.sync-waves", since),
    );

    await clickWhenShown(session, frame, '[data-section="selection"] button', "Freeze");
    await confirmDialog(session, frame, "Freeze 1", "confirm");
    await notificationMatching(session, frame, /Froze 1 of 1/);
    expect(await frozen("default")).toBe(true);

    // The list learns of the window a moment after the API has it; until then Resume refuses.
    await clickUntilDialog(session, frame, '[data-section="selection"] button', "Resume");
    await confirmDialog(session, frame, "Resume 1", "confirm");
    await notificationMatching(session, frame, /Resumed 1 of 1/);
    expect(await frozen("default")).toBe(false);
  });

  it("freezes only the ticked project not frozen yet, names the one it skips, and resumes both", async () => {
    putBack(async () => {
      await untickAll(".ArgoCDAppProjects");
      await unfreeze("default")();
      await unfreeze("demo")();
    });
    for (const name of ["default", "demo"]) expect(await frozen(name), name).toBe(false);

    await projectMenu("default", "Freeze deploys");
    await confirmDialog(session, frame, "Freeze");
    await notificationMatching(session, frame, /Froze deploys for default/);
    expect(await frozen("default")).toBe(true);

    await showProjects();
    await untickAll(".ArgoCDAppProjects");
    for (const name of ["default", "demo"]) {
      await js(
        `${hostRow(".ArgoCDAppProjects", name)}.querySelector(".TableCell.checkbox").click()`,
      );
    }

    const freeze = await barDialog("Freeze", /Skipped: default \(already frozen\)/);

    expect(freeze).toContain("Freeze 1 project?");
    expect(freeze).toContain("demo.");
    await confirmDialog(session, frame, "Freeze 1", "confirm");
    await notificationMatching(session, frame, /Froze 1 of 1/);
    expect(await frozen("demo")).toBe(true);
    expect(await frozen("default"), "default was frozen twice over").toBe(true);
    expect(
      ((await project("default"))?.spec?.syncWindows ?? []).filter(
        (each: KubeObject) => each.description === FROZEN,
      ),
    ).toHaveLength(1);

    const resume = await barDialog("Resume", /Resume 2 projects\?/);

    expect(resume).not.toContain("Skipped");
    await confirmDialog(session, frame, "Resume 2", "confirm");
    await notificationMatching(session, frame, /Resumed 2 of 2/);
    for (const name of ["default", "demo"]) expect(await frozen(name), name).toBe(false);
  });
});
