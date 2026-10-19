import { onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickMenuItem,
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  drawerTitle,
  shownDrawer,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  clickUndo,
  clusterObject,
  type KubeObject,
  putBackWith,
  restore,
} from "../../../../build/e2e/writes";

export const CLUSTERS = "/apis/postgresql.cnpg.io/v1/clusters";
export const DRAWER = ".CNPGObjectDrawer";
export const ICON = (name: string) =>
  `[...document.querySelectorAll(${JSON.stringify(`${DRAWER} .drawer-title i.Icon`)})].find((each) => each.textContent.trim() === ${JSON.stringify(name)})`;

export interface ClusterItem {
  metadata: { name: string; namespace: string; annotations?: Record<string, string> };
  spec: { instances: number; plugins?: unknown[] };
  status?: {
    currentPrimary?: string;
    readyInstances?: number;
    instanceNames?: string[];
    systemID?: string;
  };
}

export interface PodItem {
  metadata: { name: string; creationTimestamp: string };
}

export const replicatedCluster = async (session: Session, frame: number) => {
  const found = (await clusterItems<ClusterItem>(session, frame, CLUSTERS)).find(
    (each) => each.spec.instances > 2 && each.status?.readyInstances === each.spec.instances,
  );

  if (!found) throw new Error("the dev cluster has no Postgres cluster with three ready instances");

  return found;
};

export const healthyCluster = (clusters: ClusterItem[]) => {
  const found = clusters.find(
    (each) =>
      (each.status?.readyInstances ?? 0) > 1 &&
      each.status?.readyInstances === each.spec.instances &&
      each.metadata.annotations?.["cnpg.io/hibernation"] !== "on" &&
      (each.spec.plugins?.length ?? 0) > 0,
  );

  if (!found)
    throw new Error("the dev cluster has no healthy, replicated, backed-up Postgres cluster");

  return found.metadata.name;
};

export const cnpgHelpers = (page: () => { session: Session; frame: number }) => {
  /** Opens the drawer of the cluster whose row starts with `name`. */
  const openCluster = async (name: string) => {
    const { session, frame } = page();

    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    await waitFor("the clusters table", async () =>
      (await countOf(session, frame, '[data-section="cnpg-clusters"] tbody tr')) > 0
        ? true
        : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr td:not(.CNPG-table__check)')]
        .find((cell) => cell.textContent.startsWith(${JSON.stringify(name)}))?.click()`,
      frame,
    );

    return waitFor(`${name}'s drawer`, async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-cluster"]`)) > 0
        ? session.evaluate<string>(
            `document.querySelector(${JSON.stringify(DRAWER)}).textContent`,
            frame,
          )
        : undefined,
    );
  };

  const openDetail = async (name: string) => {
    const { session, frame } = page();

    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    await waitFor("the clusters", async () =>
      (await countOf(session, frame, '[data-section="cnpg-clusters"] tbody tr')) > 0
        ? true
        : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr td:not(.CNPG-table__check)')].find((cell) => cell.textContent.startsWith(${JSON.stringify(name)}))?.click()`,
      frame,
    );
    await waitFor("the drawer", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-instances"]`)) > 0
        ? true
        : undefined,
    );
  };

  const closeDrawer = async (section = "cnpg-cluster") => {
    const { session, frame } = page();

    await session.evaluate(`${ICON("close")}?.click()`, frame);
    await waitFor("the drawer to close", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="${section}"]`)) === 0
        ? true
        : undefined,
    );
  };

  /** Opens an instance row's ⋮ menu and picks an item. */
  const fromInstanceMenu = async (instance: string, item: string) => {
    const { session, frame } = page();

    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row')].find((row) => row.querySelector('.CNPG-row__name b')?.textContent === ${JSON.stringify(instance)})?.querySelector('.CNPG-row__actions i.Icon')?.click()`,
      frame,
    );
    await clickMenuItem(session, frame, item);
  };

  const textOf = (selector: string) => {
    const { session, frame } = page();

    return session.evaluate<string>(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
      frame,
    );
  };

  const fromRowMenu = async (section: string, row: string, item: string) => {
    const { session, frame } = page();

    await session.evaluate(
      `[...document.querySelectorAll('[data-section="${section}"] tbody tr')].find((tr) => tr.textContent.startsWith(${JSON.stringify(row)}))?.querySelector('.CNPG-table__actions i.Icon')?.click()`,
      frame,
    );
    await clickMenuItem(session, frame, item);
  };

  // Freelens keeps dock tabs across restarts and suffixes a repeated title " (2)": count, never assume.
  const dockTabs = (title: string) => {
    const { session, frame } = page();

    return session.evaluate<number>(
      `[...document.querySelectorAll('.Dock [class*="DockTab"] [class*="title"]')].filter((each) => each.textContent.trim().startsWith(${JSON.stringify(title)})).length`,
      frame,
    );
  };

  // A bare click() leaves the tab open, and an open psql tab keeps its session alive in the pod.
  const closeLastDockTab = (title: string) => {
    const { session, frame } = page();

    return session.evaluate(
      `(() => {
        const tab = [...document.querySelectorAll('.Dock [class*="DockTab"]')].filter((each) => each.querySelector('[class*="title"]')?.textContent.trim().startsWith(${JSON.stringify(title)})).at(-1);
        const close = tab?.querySelector('[class*="close"]');
        const target = close?.querySelector("i") ?? close;
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
      })()`,
      frame,
    );
  };

  const opensDockTab = async (button: string, title: string, shows?: string) => {
    const { session, frame } = page();
    const before = await dockTabs(title);

    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-instances"] button`,
      button,
    );

    const after = await waitFor(`a new "${title}" tab`, async () => {
      const now = await dockTabs(title);

      return now > before ? now : undefined;
    });

    // The host fits its terminal 250 ms after the dock resizes, and throws if the tab is gone by then.
    if (shows) {
      await waitFor(`"${shows}" in the "${title}" tab`, async () =>
        (
          await session.evaluate<string>(
            `document.querySelector('.Dock .xterm-rows')?.textContent ?? ""`,
            frame,
          )
        ).includes(shows)
          ? true
          : undefined,
      );
    }

    await closeLastDockTab(title);
    await waitFor(`the "${title}" tab to close`, async () =>
      (await dockTabs(title)) === before ? true : undefined,
    );

    return after - before;
  };

  return {
    openCluster,
    openDetail,
    closeDrawer,
    fromInstanceMenu,
    textOf,
    fromRowMenu,
    opensDockTab,
  };
};

export const NS = "/apis/postgresql.cnpg.io/v1/namespaces/databases";
export const PODS = "/api/v1/namespaces/databases/pods";
export const HEALTHY = "Cluster in healthy state";

export const cnpgWrites = (page: () => { session: Session; frame: number }) => {
  const js = <T>(code: string) => {
    const { session, frame } = page();

    return session.evaluate<T>(code, frame);
  };
  const get = (path: string) => {
    const { session, frame } = page();

    return clusterObject(session, frame, path);
  };
  const cluster = (name: string) => get(`${NS}/clusters/${name}`);
  // A Pooler's pods carry the cluster label too; only instances sleep with it.
  const podsOf = async (name: string) =>
    ((await get(`${PODS}?labelSelector=cnpg.io%2Fcluster%3D${name}%2Ccnpg.io%2FpodRole%3Dinstance`))
      ?.items ?? []) as KubeObject[];
  const healthy = async (name: string) => (await cluster(name))?.status?.phase === HEALTHY;
  const backups = () => {
    const { session, frame } = page();

    return clusterItems<KubeObject>(session, frame, `${NS}/backups`);
  };
  const icon = (name: string) =>
    js(
      `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)}).click()`,
    );

  const showList = async (name: string) => {
    const { session, frame } = page();

    await clickSidebar(session, frame, `cnpg-${name}`, "cnpg");
    await waitFor(`${name} rows`, async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="cnpg-${name}"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
  };

  const openRow = async (name: string, row: string, section: string) => {
    const { session, frame } = page();

    await showList(name);
    await js(
      `[...document.querySelectorAll('[data-section="cnpg-${name}"] tbody tr')].find((each) => each.textContent.startsWith(${JSON.stringify(row)}))?.querySelector("td:not(.CNPG-table__check)").click()`,
    );
    await waitFor(`${row}'s drawer`, async () =>
      (await js<number>(
        `${shownDrawer(DRAWER)}?.querySelectorAll('[data-section="${section}"]').length ?? 0`,
      )) > 0 && (await drawerTitle(session, frame, DRAWER)).endsWith(row)
        ? true
        : undefined,
    );
  };

  const openCluster = (name: string) => openRow("clusters", name, "cnpg-cluster");

  const rowMenu = async (name: string, row: string, item: string) => {
    const { session, frame } = page();

    await showList(name);
    await js(
      `[...document.querySelectorAll('[data-section="cnpg-${name}"] tbody tr')].find((each) => each.textContent.startsWith(${JSON.stringify(row)}))?.querySelector(".CNPG-table__actions i.Icon").click()`,
    );
    await clickMenuItem(session, frame, item);
  };

  const instanceMenu = async (instance: string, item: string) => {
    const { session, frame } = page();

    await js(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row')].find((row) => row.querySelector(".CNPG-row__name b")?.textContent === ${JSON.stringify(instance)}).querySelector(".CNPG-row__actions i.Icon").click()`,
    );
    await clickMenuItem(session, frame, item);
  };

  const putBack = putBackWith(onTestFinished);
  const patch = (path: string, body: object) => {
    const { session, frame } = page();

    return restore(session, frame, "PATCH", `${NS}/${path}`, body);
  };
  const undo = (notice: RegExp, label: string) => {
    const { session, frame } = page();

    return clickUndo(session, frame, notice, /Undone\./, label);
  };

  return {
    js,
    get,
    cluster,
    podsOf,
    healthy,
    backups,
    icon,
    showList,
    openRow,
    openCluster,
    rowMenu,
    instanceMenu,
    putBack,
    patch,
    undo,
  };
};
