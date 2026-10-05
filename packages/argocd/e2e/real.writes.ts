import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";
import {
  clickUndo,
  clusterObject,
  confirmDialog,
  type KubeObject,
  notificationMatching,
  restore,
  untilCluster,
} from "../../../build/e2e/writes";
import { showAllAttention } from "./attention";

const APPS = "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications";
const PROJECTS = "/apis/argoproj.io/v1alpha1/namespaces/argocd/appprojects";
const RULES = "/apis/argocd-image-updater.argoproj.io/v1alpha1/namespaces/argocd/imageupdaters";
const FROZEN = "Frozen from Freelens";
const OLD_GUESTBOOK = "5c2d89b";

// Each test leaves the Applications, projects and rules as the seed made them: synced where they
// were, no sync window, the rules' images and settings unchanged.
describe("ArgoCD writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const js = <T>(code: string) => session.evaluate<T>(code, frame);
  const get = (path: string) => clusterObject(session, frame, path);
  const app = (name: string) => get(`${APPS}/${name}`);
  const project = (name: string) => get(`${PROJECTS}/${name}`);
  const frozen = async (name: string) =>
    ((await project(name))?.spec?.syncWindows ?? []).some(
      (each: KubeObject) => each.description === FROZEN,
    );

  const reconciledSince = async (name: string, since: number) => {
    const now = await app(name);
    return (
      Date.parse(now?.status?.reconciledAt ?? "") >= since - 1000 &&
      !now?.metadata?.annotations?.["argocd.argoproj.io/refresh"]
    );
  };

  /** A sync this suite started: by freelens, after `since`. */
  const syncedByUs = async (name: string, since: number) => {
    const state = (await app(name))?.status?.operationState;
    return (
      state?.operation?.initiatedBy?.username === "freelens" &&
      Date.parse(state?.startedAt ?? "") >= since - 1000
    );
  };

  const hostRow = (list: string, name: string) =>
    `[...document.querySelectorAll('${list} .TableRow')].find((row) => [...row.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === ${JSON.stringify(name)}))`;

  const showApplications = async () => {
    await clickSidebar(session, frame, "argocd-applications", "argocd");
    await waitFor("the Applications", async () =>
      (await js<number>("document.querySelectorAll('.ArgoCDApplications .TableRow').length")) > 1
        ? true
        : undefined,
    );
  };

  const showProjects = async () => {
    await clickSidebar(session, frame, "argocd-projects", "argocd");
    await waitFor("the projects", async () =>
      (await js<number>("document.querySelectorAll('.ArgoCDAppProjects .TableRow').length")) > 0
        ? true
        : undefined,
    );
  };

  const appMenu = async (name: string, item: string) => {
    await showApplications();
    await js(
      `${hostRow(".ArgoCDApplications", name)}.querySelector(".TableCell.menu i.Icon").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  const projectMenu = async (name: string, item: string) => {
    await showProjects();
    await js(
      `${hostRow(".ArgoCDAppProjects", name)}.querySelector(".TableCell.menu i.Icon").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  it("refreshes guestbook from its menu", async () => {
    const since = Date.now();

    await appMenu("guestbook", "Refresh");
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
    await notificationMatching(session, frame, /Hard refresh requested for guestbook-pinned/);
    await untilCluster("guestbook-pinned compared again", () =>
      reconciledSince("guestbook-pinned", since),
    );
  });

  it("syncs the drifted helm-guestbook: its replicas go back to what git says", async () => {
    const since = Date.now();

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

    // The seed's drift.
    await restore(
      session,
      frame,
      "PATCH",
      "/apis/apps/v1/namespaces/demo/deployments/helm-guestbook",
      {
        spec: { replicas: 2 },
      },
    );
  });

  it("syncs two ticked Applications from the list", async () => {
    const since = Date.now();

    await showApplications();
    for (const name of ["guestbook", "guestbook-pinned"]) {
      await js(
        `${hostRow(".ArgoCDApplications", name)}.querySelector(".TableCell.checkbox").click()`,
      );
    }
    await clickByText(session, frame, '[data-section="selection"] button', "Sync");
    await confirmDialog(session, frame, "Sync 2", "confirm");
    await notificationMatching(session, frame, /Started a sync on 2 Applications/);

    for (const name of ["guestbook", "guestbook-pinned"]) {
      await untilCluster(`${name} synced by freelens`, () => syncedByUs(name, since));
    }
    await js(
      `[...document.querySelectorAll('.ArgoCDApplications .TableRow .TableCell.checkbox input:checked')].forEach((box) => box.click())`,
    );
  });

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
    await projectMenu("default", "Freeze deploys");
    await confirmDialog(session, frame, "Freeze");
    await notificationMatching(session, frame, /Froze deploys for default/);
    expect(await frozen("default")).toBe(true);

    await clickUndo(session, frame, /Froze deploys for default/, /Resumed deploys for default/);
    expect(await frozen("default")).toBe(false);
  });

  it("freezes demo, holds a sync of helm-guestbook, terminates it, and resumes demo", async () => {
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
    await restore(session, frame, "PATCH", `${PROJECTS}/demo`, { spec: { syncWindows: null } });
  });

  it("refreshes, freezes and resumes the ticked default project from the projects list", async () => {
    await showProjects();
    await js(
      `${hostRow(".ArgoCDAppProjects", "default")}.querySelector(".TableCell.checkbox").click()`,
    );

    const since = Date.now();
    await clickByText(session, frame, '[data-section="selection"] button', "Refresh all");
    await confirmDialog(session, frame, "Refresh 1");
    await notificationMatching(session, frame, /Refreshed 1 of 1/);
    await untilCluster("example.sync-waves compared again", () =>
      reconciledSince("example.sync-waves", since),
    );

    await clickByText(session, frame, '[data-section="selection"] button', "Freeze");
    await confirmDialog(session, frame, "Freeze 1", "confirm");
    await notificationMatching(session, frame, /Froze 1 of 1/);
    expect(await frozen("default")).toBe(true);

    // The list learns of the window a moment after the API has it; until then Resume refuses.
    await waitFor("Resume to be offered", async () => {
      await clickByText(session, frame, '[data-section="selection"] button', "Resume");
      return (
        (await js<number>("document.querySelectorAll('.ConfirmDialog').length")) > 0 || undefined
      );
    });
    await confirmDialog(session, frame, "Resume 1", "confirm");
    await notificationMatching(session, frame, /Resumed 1 of 1/);
    expect(await frozen("default")).toBe(false);
    await restore(session, frame, "PATCH", `${PROJECTS}/default`, { spec: { syncWindows: null } });
  });

  it("refreshes what the overview shows needing attention", async () => {
    const since = Date.now();

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await showAllAttention(session, frame);
    await clickByText(
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

    await appMenu("guestbook", `(${OLD_GUESTBOOK})`);
    await confirmDialog(session, frame, "Roll back");
    await notificationMatching(session, frame, /Rollback of guestbook to deploy #\d+ started/);

    const rolled = await app("guestbook");
    expect(rolled?.spec?.syncPolicy?.automated).toBeUndefined();
    await untilCluster("the rollback by freelens", async () => {
      const state = (await app("guestbook"))?.status?.operationState;
      return (
        Date.parse(state?.startedAt ?? "") >= since - 1000 &&
        state?.operation?.sync?.revision?.startsWith(OLD_GUESTBOOK) &&
        state?.phase === "Succeeded"
      );
    });

    await restore(session, frame, "PATCH", `${APPS}/guestbook`, {
      spec: { syncPolicy: { automated: { selfHeal: true } } },
    });
    await untilCluster("guestbook back on HEAD", async () => {
      const now = await app("guestbook");
      return (
        now?.status?.sync?.status === "Synced" &&
        !now?.status?.sync?.revision?.startsWith(OLD_GUESTBOOK)
      );
    });
  });

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
    await clickByText(session, frame, ".ArgoCD-page__actions button", "Check now");
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
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", "Edit");
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
    await clickByText(session, frame, ".ConfirmDialog .ArgoCD-filter", "newest-build");
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
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", "Undo");
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

  it("leaves no project frozen", async () => {
    for (const name of ["default", "demo"]) expect(await frozen(name), name).toBe(false);
  });
});
