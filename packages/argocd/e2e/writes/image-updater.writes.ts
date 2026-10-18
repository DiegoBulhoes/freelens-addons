import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickMenuItem,
  clickSidebar,
  clickWhenShown,
  openWorkbench,
  pressChip,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  clickUndo,
  confirmDialog,
  notificationMatching,
  putBackWith,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { APPS, argocdWrites, JSON_PATCH, RULES } from "../support/writes";

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

  const { js, get, app, thawAndClose } = argocdWrites(() => ({ session, frame }));

  afterAll(thawAndClose);

  it("restarts the Image Updater controller with Check now", async () => {
    const path = "/apis/apps/v1/namespaces/argocd/deployments/argocd-image-updater-controller";
    const before = (await get(path))?.spec?.template?.metadata?.annotations?.[
      "kubectl.kubernetes.io/restartedAt"
    ];

    await clickSidebar(session, frame, "image-updater-overview", [
      "argocd",
      "argocd-image-updater",
    ]);
    await waitFor("Check now", async () =>
      (await js<number>(
        `[...document.querySelectorAll(".ArgoCD-page__actions button")].filter((each) => each.textContent.includes("Check now")).length`,
      )) > 0
        ? true
        : undefined,
    );
    await clickWhenShown(session, frame, ".ArgoCD-page__actions button", "Check now");
    await confirmDialog(session, frame, "Restart");
    await notificationMatching(session, frame, /Restarted argocd\/argocd-image-updater-controller/);

    const after = (await get(path))?.spec?.template?.metadata?.annotations?.[
      "kubectl.kubernetes.io/restartedAt"
    ];
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    await untilCluster("the controller rolled out", async () => {
      const deployment = await get(path);
      return (
        deployment?.status?.updatedReplicas === deployment?.spec?.replicas &&
        deployment?.status?.availableReplicas === deployment?.spec?.replicas
      );
    });
  });

  it("edits the image of the retired rule, and Undo puts it back", async () => {
    const before = (await get(`${RULES}/retired`))?.spec?.applicationRefs?.[0]?.images?.[0];

    putBack(async () => {
      const now = (await get(`${RULES}/retired`))?.spec?.applicationRefs?.[0]?.images?.[0];

      if (JSON.stringify(now) === JSON.stringify(before)) return;
      await restore(
        session,
        frame,
        "PATCH",
        `${RULES}/retired`,
        [{ op: "replace", path: "/spec/applicationRefs/0/images/0", value: before }],
        JSON_PATCH,
      );
    });

    await clickSidebar(session, frame, "image-updater-images", ["argocd", "argocd-image-updater"]);
    await waitFor("the images", async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="image-updater-images"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('[data-section="image-updater-images"] tbody tr')].find((row) => row.textContent.includes("legacy-api")).querySelector(".ArgoCD-table__actions i.Icon").click()`,
    );
    await clickMenuItem(session, frame, "Edit");
    await waitFor("the fields", async () =>
      (await js<number>(
        `document.querySelectorAll('.ConfirmDialog input[aria-label="Version constraint"]').length`,
      )) > 0
        ? true
        : undefined,
    );
    await typeInto(
      session,
      frame,
      '.ConfirmDialog input[aria-label="Version constraint"]',
      "5.2.x",
    );
    await pressChip(session, frame, ".ConfirmDialog .ArgoCD-filter", "newest-build");
    await confirmDialog(session, frame, "Save");
    await notificationMatching(session, frame, /Changed legacy-api in retired to newest-build/);

    const edited = (await get(`${RULES}/retired`))?.spec?.applicationRefs?.[0]?.images?.[0];
    expect(edited?.imageName).toBe("ghcr.io/stefanprodan/podinfo:5.2.x");
    expect(edited?.commonUpdateSettings?.updateStrategy).toBe("newest-build");

    await clickUndo(
      session,
      frame,
      /Changed legacy-api in retired/,
      /Put legacy-api in retired back/,
    );
    expect((await get(`${RULES}/retired`))?.spec?.applicationRefs?.[0]?.images?.[0]).toEqual(
      before,
    );
  });

  it("undoes podinfo-patches' update by pinning the old tag, and Undo moves it forward again", async () => {
    const image = async () => (await app("image-updates"))?.spec?.source?.kustomize?.images?.[0];
    const settings = async () =>
      (await get(`${RULES}/podinfo-patches`))?.spec?.applicationRefs?.[0]?.images?.[0]
        ?.commonUpdateSettings;
    const before = { image: await image(), settings: await settings() };

    putBack(async () => {
      if ((await image()) !== before.image) {
        await restore(
          session,
          frame,
          "PATCH",
          `${APPS}/image-updates`,
          [{ op: "replace", path: "/spec/source/kustomize/images/0", value: before.image }],
          JSON_PATCH,
        );
      }
      if (JSON.stringify(await settings()) !== JSON.stringify(before.settings)) {
        await restore(
          session,
          frame,
          "PATCH",
          `${RULES}/podinfo-patches`,
          [
            {
              op: "replace",
              path: "/spec/applicationRefs/0/images/0/commonUpdateSettings",
              value: before.settings,
            },
          ],
          JSON_PATCH,
        );
      }
    });

    await untilCluster(
      "an update the controller made",
      async () => ((await get(`${RULES}/podinfo-patches`))?.status?.recentUpdates ?? []).length > 0,
      10 * 60_000,
    );
    await clickSidebar(session, frame, "image-updater-updates", ["argocd", "argocd-image-updater"]);
    await waitFor("the updates", async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="image-updater-updates"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('[data-section="image-updater-updates"] tbody tr')].find((row) => row.textContent.includes("podinfo-patches")).querySelector(".ArgoCD-table__actions i.Icon").click()`,
    );
    await clickMenuItem(session, frame, "Undo");
    await confirmDialog(session, frame, "Undo");
    await notificationMatching(
      session,
      frame,
      /Put podinfo back on 6\.13\.0, and podinfo-patches now allows only that tag/,
    );

    expect(await image()).toBe("ghcr.io/stefanprodan/podinfo:6.13.0");
    expect((await settings())?.allowTags).toBe("^6\\.13\\.0$");

    await clickUndo(session, frame, /Put podinfo back on 6\.13\.0/, /Put podinfo back on 6\.14\.1/);
    expect(await image()).toBe(before.image);
    expect(await settings()).toEqual(before.settings);
  });
});
