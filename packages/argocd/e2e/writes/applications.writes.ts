import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  putBackWith,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { showAllAttention } from "../support/attention";
import { APPS, argocdWrites, OLD_GUESTBOOK } from "../support/writes";

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
    get,
    app,
    reconciledSince,
    syncedByUs,
    untickAll,
    restoreHelmGuestbookDrift,
    hostRow,
    showApplications,
    appMenu,
    thawAndClose,
  } = argocdWrites(() => ({ session, frame }));

  afterAll(thawAndClose);

  it("refreshes guestbook from its menu", async () => {
    const since = Date.now();

    await appMenu("guestbook", "Refresh");
    expect(await confirmDialog(session, frame, "Refresh")).toContain("Refresh guestbook?");
    await notificationMatching(session, frame, /Refresh requested for guestbook/);
    await untilCluster("guestbook compared again", () => reconciledSince("guestbook", since));
  });

  it("hard-refreshes guestbook-pinned from its drawer", async () => {
    const since = Date.now();

    await showApplications();
    await js(`${hostRow(".ArgoCDApplications", "guestbook-pinned")}.click()`);
    await waitFor("its drawer", async () =>
      (await js<number>(`document.querySelectorAll(".Drawer .drawer-title i.Icon").length`)) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll(".Drawer .drawer-title i.Icon")].find((each) => each.textContent.trim() === "layers_clear").click()`,
    );
    await confirmDialog(session, frame, "Hard refresh");
    await notificationMatching(session, frame, /Hard refresh requested for guestbook-pinned/);
    await untilCluster("guestbook-pinned compared again", () =>
      reconciledSince("guestbook-pinned", since),
    );
  });

  it("syncs the drifted helm-guestbook: its replicas go back to what git says", async () => {
    const since = Date.now();

    // The seed's drift.
    putBack(restoreHelmGuestbookDrift);

    await appMenu("helm-guestbook", "Sync");
    await confirmDialog(session, frame, "Sync");
    await notificationMatching(session, frame, /Sync started for helm-guestbook\./);

    await untilCluster("the sync by freelens", () => syncedByUs("helm-guestbook", since));
    await untilCluster(
      "helm-guestbook synced",
      async () => (await app("helm-guestbook"))?.status?.sync?.status === "Synced",
    );
    expect(
      (await get("/apis/apps/v1/namespaces/demo/deployments/helm-guestbook"))?.spec?.replicas,
    ).not.toBe(2);
  });

  it("syncs two ticked Applications from the list", async () => {
    const since = Date.now();

    putBack(async () => {
      await untickAll(".ArgoCDApplications");
    });
    await showApplications();
    for (const name of ["guestbook", "guestbook-pinned"]) {
      await js(
        `${hostRow(".ArgoCDApplications", name)}.querySelector(".TableCell.checkbox").click()`,
      );
    }
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Sync");
    await confirmDialog(session, frame, "Sync 2", "confirm");
    await notificationMatching(session, frame, /Started a sync on 2 Applications/);

    for (const name of ["guestbook", "guestbook-pinned"]) {
      await untilCluster(`${name} synced by freelens`, () => syncedByUs(name, since));
    }
  });

  it("refreshes what the overview shows needing attention", async () => {
    const since = Date.now();

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await showAllAttention(session, frame);
    await clickWhenShown(
      session,
      frame,
      '[data-section="attention"] .ArgoCD-actions button',
      "Refresh",
    );
    const dialog = await confirmDialog(session, frame, "Refresh");
    const count = Number(dialog.match(/Refresh all (\d+) Applications/)?.[1]);

    expect(count).toBeGreaterThan(1);
    await notificationMatching(
      session,
      frame,
      new RegExp(`Requested a refresh of ${count} Applications`),
    );
    await untilCluster("missing-path compared again", () => reconciledSince("missing-path", since));
  });

  it("rolls guestbook back to its older commit, then hands it back to self-heal", async () => {
    const since = Date.now();
    const saved = "freelens-addons/auto-sync-before-rollback";
    const seeded = (await app("guestbook"))?.spec?.syncPolicy?.automated;

    expect(seeded, "guestbook is not auto-synced, as the seed makes it").toEqual({
      selfHeal: true,
    });
    // Whatever step failed: the seed's auto-sync back, and no record left.
    putBack(async () => {
      const now = await app("guestbook");

      if (
        now?.metadata?.annotations?.[saved] === undefined &&
        JSON.stringify(now?.spec?.syncPolicy?.automated) === JSON.stringify(seeded)
      ) {
        return;
      }
      await restore(session, frame, "PATCH", `${APPS}/guestbook`, {
        metadata: { annotations: { [saved]: null } },
        spec: { syncPolicy: { automated: seeded } },
      });
    });

    await appMenu("guestbook", `(${OLD_GUESTBOOK})`);
    expect(await confirmDialog(session, frame, "Roll back")).toContain(
      "turns off its automated sync with self-heal",
    );
    await notificationMatching(
      session,
      frame,
      /Rollback of guestbook to deploy #\d+ started, and its automated sync was turned off/,
    );

    const rolled = await app("guestbook");
    expect(rolled?.spec?.syncPolicy?.automated).toBeUndefined();
    expect(JSON.parse(rolled?.metadata?.annotations?.[saved] ?? "null")).toEqual({
      selfHeal: true,
    });
    await untilCluster("the rollback by freelens", async () => {
      const state = (await app("guestbook"))?.status?.operationState;
      return (
        Date.parse(state?.startedAt ?? "") >= since - 1000 &&
        state?.operation?.sync?.revision?.startsWith(OLD_GUESTBOOK) &&
        state?.operation?.sync?.source?.path === "guestbook" &&
        state?.phase === "Succeeded"
      );
    });

    // The notification's Undo has gone by now: the menu offers the same, from the record.
    await appMenu("guestbook", "Resume auto-sync");
    await confirmDialog(session, frame, "Resume auto-sync");
    await notificationMatching(session, frame, /Automated sync of guestbook is back as it was/);
    await untilCluster("auto-sync as it was, and the record gone", async () => {
      const now = await app("guestbook");
      return (
        now?.spec?.syncPolicy?.automated?.selfHeal === true &&
        now?.metadata?.annotations?.[saved] === undefined
      );
    });

    await untilCluster("guestbook back on HEAD", async () => {
      const now = await app("guestbook");
      return (
        now?.status?.sync?.status === "Synced" &&
        !now?.status?.sync?.revision?.startsWith(OLD_GUESTBOOK)
      );
    });
  });
});
