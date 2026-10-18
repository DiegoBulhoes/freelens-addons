import type { Session } from "../../../../build/e2e/cdp";
import {
  cancelDialog,
  clickMenuItem,
  clickSidebar,
  clickUntilDialog,
  waitFor,
} from "../../../../build/e2e/freelens";
import { clusterObject, type KubeObject, restore } from "../../../../build/e2e/writes";

export const APPS = "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications";
export const PROJECTS = "/apis/argoproj.io/v1alpha1/namespaces/argocd/appprojects";
export const RULES =
  "/apis/argocd-image-updater.argoproj.io/v1alpha1/namespaces/argocd/imageupdaters";
export const FROZEN = "Frozen from Freelens";
export const OLD_GUESTBOOK = "5c2d89b";
export const JSON_PATCH = "application/json-patch+json";
export const BAR = '[data-section="selection"]';

export function argocdWrites(context: () => { session: Session; frame: number }) {
  const js = <T>(code: string) => context().session.evaluate<T>(code, context().frame);
  const get = (path: string) => clusterObject(context().session, context().frame, path);
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

  /** Removes only the window a freeze adds, so a project's own windows stay. */
  const unfreeze = (name: string) => async () => {
    const windows: KubeObject[] = (await project(name))?.spec?.syncWindows ?? [];
    const kept = windows.filter((each) => each.description !== FROZEN);

    if (kept.length === windows.length) return;
    await restore(context().session, context().frame, "PATCH", `${PROJECTS}/${name}`, {
      spec: { syncWindows: kept.length > 0 ? kept : null },
    });
  };

  const untickAll = (list: string) =>
    js(
      `[...document.querySelectorAll('${list} .TableRow .TableCell.checkbox input:checked')].forEach((box) => box.click())`,
    );

  /** Clicks a bar button until its dialog says `expected`: the list learns of a write after the API. */
  const barDialog = (button: string, expected: RegExp) =>
    waitFor(`the ${button} dialog to say ${expected}`, async () => {
      const { session, frame } = context();
      const text = await clickUntilDialog(session, frame, `${BAR} button`, button);

      if (expected.test(text)) return text;
      await cancelDialog(session, frame);
      return undefined;
    });

  const restoreHelmGuestbookDrift = () =>
    restore(
      context().session,
      context().frame,
      "PATCH",
      "/apis/apps/v1/namespaces/demo/deployments/helm-guestbook",
      {
        spec: { replicas: 2 },
      },
    );

  const hostRow = (list: string, name: string) =>
    `[...document.querySelectorAll('${list} .TableRow')].find((row) => [...row.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === ${JSON.stringify(name)}))`;

  const showApplications = async () => {
    await clickSidebar(context().session, context().frame, "argocd-applications", "argocd");
    await waitFor("the Applications", async () =>
      (await js<number>("document.querySelectorAll('.ArgoCDApplications .TableRow').length")) > 1
        ? true
        : undefined,
    );
  };

  const showProjects = async () => {
    await clickSidebar(context().session, context().frame, "argocd-projects", "argocd");
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
    await clickMenuItem(context().session, context().frame, item);
  };

  const projectMenu = async (name: string, item: string) => {
    await showProjects();
    await js(
      `${hostRow(".ArgoCDAppProjects", name)}.querySelector(".TableCell.menu i.Icon").click()`,
    );
    await clickMenuItem(context().session, context().frame, item);
  };

  const thawAndClose = async () => {
    if (!context().session) return;

    for (const name of ["default", "demo"]) {
      try {
        await unfreeze(name)();
      } catch (error) {
        console.log(`  could not thaw ${name}: ${error}`);
      }
    }
    context().session.close();
  };

  return {
    js,
    get,
    app,
    project,
    frozen,
    reconciledSince,
    syncedByUs,
    unfreeze,
    untickAll,
    barDialog,
    restoreHelmGuestbookDrift,
    hostRow,
    showApplications,
    showProjects,
    appMenu,
    projectMenu,
    thawAndClose,
  };
}
