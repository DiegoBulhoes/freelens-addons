import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  drawerTitle,
  openDrawer,
  openWorkbench,
  waitFor,
} from "../../../build/e2e/freelens";
import {
  clickUndo,
  clusterObject,
  confirmDialog,
  execIn,
  type KubeObject,
  notificationMatching,
  restore,
  untilCluster,
} from "../../../build/e2e/writes";

const DRAWER = ".CNPGObjectDrawer";
const NS = "/apis/postgresql.cnpg.io/v1/namespaces/databases";
const PODS = "/api/v1/namespaces/databases/pods";
const HEALTHY = "Cluster in healthy state";

// orders-db-3 keeps its replay paused, the seed's lag: nothing here restarts or promotes it, and
// the last test checks the pause survived. Restarts use inventory-db and billing-db.
describe("CloudNativePG writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const js = <T>(code: string) => session.evaluate<T>(code, frame);
  const get = (path: string) => clusterObject(session, frame, path);
  const cluster = (name: string) => get(`${NS}/clusters/${name}`);
  const podsOf = async (name: string) =>
    ((await get(`${PODS}?labelSelector=cnpg.io%2Fcluster%3D${name}`))?.items ?? []) as KubeObject[];
  const healthy = async (name: string) => (await cluster(name))?.status?.phase === HEALTHY;
  const backups = () => clusterItems<KubeObject>(session, frame, `${NS}/backups`);
  const icon = (name: string) =>
    js(
      `[...(${openDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)}).click()`,
    );

  const showList = async (page: string) => {
    await clickSidebar(session, frame, `cnpg-${page}`, "cnpg");
    await waitFor(`${page} rows`, async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="cnpg-${page}"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
  };

  const openRow = async (page: string, name: string, section: string) => {
    await showList(page);
    await js(
      `[...document.querySelectorAll('[data-section="cnpg-${page}"] tbody tr')].find((row) => row.textContent.startsWith(${JSON.stringify(name)}))?.querySelector("td:not(.CNPG-table__check)").click()`,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await js<number>(
        `${openDrawer(DRAWER)}?.querySelectorAll('[data-section="${section}"]').length ?? 0`,
      )) > 0 && (await drawerTitle(session, frame, DRAWER)).endsWith(name)
        ? true
        : undefined,
    );
  };

  const openCluster = (name: string) => openRow("clusters", name, "cnpg-cluster");

  const rowMenu = async (page: string, name: string, item: string) => {
    await showList(page);
    await js(
      `[...document.querySelectorAll('[data-section="cnpg-${page}"] tbody tr')].find((row) => row.textContent.startsWith(${JSON.stringify(name)}))?.querySelector(".CNPG-table__actions i.Icon").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  const instanceMenu = async (instance: string, item: string) => {
    await js(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row')].find((row) => row.querySelector(".CNPG-row__name b")?.textContent === ${JSON.stringify(instance)}).querySelector(".CNPG-row__actions i.Icon").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  const undo = (notice: RegExp, label: string) =>
    clickUndo(session, frame, notice, /Undone\./, label);

  /** A backup the test started: completed, then deleted so the list stays the seed's. */
  const backupCompletes = async (prefix: string, since: number) => {
    const created = await untilCluster(`a backup named ${prefix}-*`, async () =>
      (await backups()).find(
        (each) =>
          each.metadata.name.startsWith(`${prefix}-`) &&
          Date.parse(each.metadata.creationTimestamp) >= since - 1000,
      ),
    );

    await untilCluster(`${created.metadata.name} to complete`, async () => {
      const phase = (await get(`${NS}/backups/${created.metadata.name}`))?.status?.phase;
      if (phase === "failed") throw new Error(`${created.metadata.name} failed`);
      return phase === "completed";
    });
    await restore(session, frame, "DELETE", `${NS}/backups/${created.metadata.name}`);

    return created;
  };

  const postmasterStart = async (pod: string) =>
    (
      await session.evaluate<string>(
        `fetch("/api-kube${PODS}/${pod}:9187/proxy/metrics").then((response) => response.text())`,
        frame,
      )
    ).match(/^cnpg_pg_postmaster_start_time\S*\s+(\S+)/m)?.[1];

  it("backs up orders-db from its drawer, from a standby", async () => {
    const since = Date.now();

    await openCluster("orders-db");
    await icon("backup");
    await waitFor("the target choice", async () =>
      (await js<number>(`document.querySelectorAll(".ConfirmDialog .CNPG-filter").length`)) > 0
        ? true
        : undefined,
    );
    await clickByText(session, frame, ".ConfirmDialog .CNPG-filter", "Prefer a standby");
    await confirmDialog(session, frame, "Back up");
    await notificationMatching(session, frame, /Backup orders-db-\d+ started for orders-db/);

    const backup = await backupCompletes("orders-db", since);

    expect(backup.spec.target).toBe("prefer-standby");
    expect(backup.spec.pluginConfiguration?.name).toBe("barman-cloud.cloudnative-pg.io");
  });

  it("backs up orders-db from the Backups page", async () => {
    const since = Date.now();

    await showList("backups");
    await clickByText(session, frame, ".CNPG-page__actions button", "Back up");
    await waitFor("the cluster choice", async () =>
      (await js<number>(`document.querySelectorAll(".ConfirmDialog .CNPG-filter").length`)) > 0
        ? true
        : undefined,
    );
    await clickByText(session, frame, ".ConfirmDialog .CNPG-filter", "databases/orders-db");
    await confirmDialog(session, frame, "Back up");
    await notificationMatching(session, frame, /Backup orders-db-\d+ started for orders-db/);

    expect((await backupCompletes("orders-db", since)).spec.target).toBeUndefined();
  });

  it("backs up now as the orders-hourly schedule would, from its menu", async () => {
    const since = Date.now();

    await rowMenu("schedules", "orders-hourly", "Back up now");
    await confirmDialog(session, frame, "Back up");
    await notificationMatching(session, frame, /Backup orders-hourly-\d+ started for orders-db/);

    await backupCompletes("orders-hourly", since);
  });

  it("reloads inventory-db: the annotation moves and no pod restarts", async () => {
    const before = (await cluster("inventory-db"))?.metadata?.annotations?.["cnpg.io/reloadedAt"];
    const uids = (await podsOf("inventory-db")).map((each) => each.metadata.uid);

    await openCluster("inventory-db");
    await icon("sync");
    await confirmDialog(session, frame, "Reload");
    await notificationMatching(session, frame, /Reload requested for inventory-db/);

    const after = await untilCluster("the reload annotation", async () => {
      const value = (await cluster("inventory-db"))?.metadata?.annotations?.["cnpg.io/reloadedAt"];
      return value && value !== before ? value : false;
    });

    expect(after).not.toBe(before);
    expect((await podsOf("inventory-db")).map((each) => each.metadata.uid)).toEqual(uids);
    await restore(session, frame, "PATCH", `${NS}/clusters/inventory-db`, {
      metadata: { annotations: { "cnpg.io/reloadedAt": null } },
    });
  });

  it("switches orders-db over to orders-db-1, and back to orders-db-2", async () => {
    await untilCluster("orders-db healthy", () => healthy("orders-db"), 10 * 60_000);

    await openCluster("orders-db");
    await icon("swap_horiz");
    await waitFor("the replica choice", async () =>
      (await js<number>(`document.querySelectorAll(".ConfirmDialog .CNPG-filter").length`)) > 0
        ? true
        : undefined,
    );
    await clickByText(session, frame, ".ConfirmDialog .CNPG-filter", "orders-db-1");
    await confirmDialog(session, frame, "Switch over", "orders-db");
    await notificationMatching(session, frame, /Switchover of orders-db to orders-db-1 started/);

    await untilCluster(
      "orders-db-1 primary",
      async () =>
        (await cluster("orders-db"))?.status?.currentPrimary === "orders-db-1" &&
        healthy("orders-db"),
      10 * 60_000,
    );

    await restore(session, frame, "PATCH", `${NS}/clusters/orders-db/status`, {
      status: {
        targetPrimary: "orders-db-2",
        phase: "Switchover in progress",
        phaseReason: "Switching over to orders-db-2",
      },
    });
    await untilCluster(
      "orders-db-2 primary again",
      async () =>
        (await cluster("orders-db"))?.status?.currentPrimary === "orders-db-2" &&
        healthy("orders-db"),
      10 * 60_000,
    );
  });

  it("restarts inventory-db: its instance is recreated and it is healthy again", async () => {
    const before = (await podsOf("inventory-db")).map((each) => each.metadata.uid);

    await openCluster("inventory-db");
    await icon("restart_alt");
    await confirmDialog(session, frame, "Restart", "inventory-db");
    await notificationMatching(session, frame, /Rolling restart requested for inventory-db/);

    await untilCluster(
      "inventory-db recreated and healthy",
      async () => {
        const pods = await podsOf("inventory-db");
        return (
          pods.length > 0 &&
          pods.every((each) => !before.includes(each.metadata.uid)) &&
          healthy("inventory-db")
        );
      },
      10 * 60_000,
    );
  });

  it("restarts the replicas of billing-db and leaves its primary alone", async () => {
    await untilCluster("billing-db healthy", () => healthy("billing-db"), 10 * 60_000);
    const primary: string = (await cluster("billing-db"))?.status?.currentPrimary;
    const pods = await podsOf("billing-db");
    const primaryUid = pods.find((each) => each.metadata.name === primary)?.metadata.uid;
    const replicas = pods.filter((each) => each.metadata.name !== primary);

    await openCluster("billing-db");
    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-instances"] button`,
      "Restart replicas",
    );
    await confirmDialog(session, frame, `Restart ${replicas.length}`, "billing-db");
    await notificationMatching(
      session,
      frame,
      /Restarted every replica of billing-db/,
      15 * 60_000,
    );

    const after = await podsOf("billing-db");
    for (const replica of replicas) {
      expect(
        after.find((each) => each.metadata.name === replica.metadata.name)?.metadata.uid,
      ).not.toBe(replica.metadata.uid);
    }
    expect(after.find((each) => each.metadata.name === primary)?.metadata.uid).toBe(primaryUid);
    expect((await cluster("billing-db"))?.status?.currentPrimary).toBe(primary);
  });

  it("restarts the replica orders-db-1 from its menu: a new pod", async () => {
    const before = (await get(`${PODS}/orders-db-1`))?.metadata?.uid;

    await openCluster("orders-db");
    await instanceMenu("orders-db-1", "Restart");
    await confirmDialog(session, frame, "Restart", "orders-db-1");
    await notificationMatching(session, frame, /Restart of orders-db-1 requested/);

    await untilCluster(
      "orders-db-1 recreated",
      async () => {
        const pod = await get(`${PODS}/orders-db-1`);
        return pod && pod.metadata.uid !== before && healthy("orders-db");
      },
      10 * 60_000,
    );
  });

  it("restarts the primary inventory-db-1 in place: same pod, a new postmaster", async () => {
    await untilCluster("inventory-db healthy", () => healthy("inventory-db"), 10 * 60_000);
    const uid = (await get(`${PODS}/inventory-db-1`))?.metadata?.uid;
    const started = await postmasterStart("inventory-db-1");

    await openCluster("inventory-db");
    await instanceMenu("inventory-db-1", "Restart");
    await confirmDialog(session, frame, "Restart", "inventory-db-1");
    await notificationMatching(session, frame, /Restart of inventory-db-1 requested/);

    await untilCluster(
      "a new postmaster",
      async () => {
        const now = await postmasterStart("inventory-db-1").catch(() => undefined);
        return now !== undefined && now !== started && healthy("inventory-db");
      },
      10 * 60_000,
    );
    expect((await get(`${PODS}/inventory-db-1`))?.metadata?.uid).toBe(uid);
  });

  it("hibernates inventory-db, keeping its volume, then wakes it", async () => {
    await openCluster("inventory-db");
    await icon("bedtime");
    await confirmDialog(session, frame, "Hibernate", "inventory-db");
    await notificationMatching(session, frame, /Hibernation requested for inventory-db/);

    await untilCluster(
      "inventory-db's pods gone",
      async () => (await podsOf("inventory-db")).length === 0,
    );
    const volumes = await get(
      "/api/v1/namespaces/databases/persistentvolumeclaims?labelSelector=cnpg.io%2Fcluster%3Dinventory-db",
    );
    expect(volumes?.items?.length).toBeGreaterThan(0);

    await openCluster("inventory-db");
    await icon("wb_sunny");
    await confirmDialog(session, frame, "Wake");
    await notificationMatching(session, frame, /Wake requested for inventory-db/);

    expect((await cluster("inventory-db"))?.metadata?.annotations?.["cnpg.io/hibernation"]).toBe(
      "off",
    );
    // The phase says healthy even while hibernated: only a ready pod shows it woke.
    await untilCluster(
      "inventory-db's pod back and ready",
      async () => {
        const pods = await podsOf("inventory-db");
        return (
          pods.length > 0 &&
          pods.every((each) =>
            each.status?.conditions?.some(
              (condition: KubeObject) => condition.type === "Ready" && condition.status === "True",
            ),
          ) &&
          healthy("inventory-db")
        );
      },
      10 * 60_000,
    );
  });

  it("wakes reports-db, and Hibernate again puts it back to sleep", async () => {
    await openCluster("reports-db");
    await icon("wb_sunny");
    await confirmDialog(session, frame, "Wake");
    await notificationMatching(session, frame, /Wake requested for reports-db/);
    expect((await cluster("reports-db"))?.metadata?.annotations?.["cnpg.io/hibernation"]).toBe(
      "off",
    );

    await undo(/Wake requested for reports-db/, "Hibernate again");
    expect((await cluster("reports-db"))?.metadata?.annotations?.["cnpg.io/hibernation"]).toBe(
      "on",
    );
    await untilCluster(
      "reports-db asleep",
      async () => (await podsOf("reports-db")).length === 0,
      10 * 60_000,
    );
  });

  it("opens and closes a node maintenance window on billing-db", async () => {
    const before = (await cluster("billing-db"))?.spec?.nodeMaintenanceWindow ?? null;

    await openCluster("billing-db");
    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-maintenance"] button`,
      "Start window",
    );
    await clickByText(session, frame, ".ConfirmDialog .CNPG-filter", "Rebuild elsewhere");
    await confirmDialog(session, frame, "Start");
    await notificationMatching(session, frame, /Maintenance window of billing-db started/);
    expect((await cluster("billing-db"))?.spec?.nodeMaintenanceWindow).toMatchObject({
      inProgress: true,
      reusePVC: false,
    });

    await openCluster("billing-db");
    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-maintenance"] button`,
      "End window",
    );
    await confirmDialog(session, frame, "End");
    await notificationMatching(session, frame, /Maintenance window of billing-db ended/);
    expect((await cluster("billing-db"))?.spec?.nodeMaintenanceWindow?.inProgress).toBe(false);

    await restore(session, frame, "PATCH", `${NS}/clusters/billing-db`, {
      spec: { nodeMaintenanceWindow: before },
    });
  });

  it("suspends orders-hourly from its menu, and Undo starts it again", async () => {
    await rowMenu("schedules", "orders-hourly", "Suspend");
    await confirmDialog(session, frame, "Suspend");
    await notificationMatching(session, frame, /Suspended orders-hourly/);
    expect((await get(`${NS}/scheduledbackups/orders-hourly`))?.spec?.suspend).toBe(true);

    await undo(/Suspended orders-hourly/, "Undo");
    expect((await get(`${NS}/scheduledbackups/orders-hourly`))?.spec?.suspend).toBe(false);
  });

  it("starts the suspended orders-weekly from its drawer, then suspends it again", async () => {
    await openRow("schedules", "orders-weekly", "cnpg-schedule");
    await icon("play_arrow");
    await confirmDialog(session, frame, "Start");
    await notificationMatching(session, frame, /Started orders-weekly/);
    expect((await get(`${NS}/scheduledbackups/orders-weekly`))?.spec?.suspend).toBe(false);

    await openRow("schedules", "orders-weekly", "cnpg-schedule");
    await icon("pause");
    await confirmDialog(session, frame, "Suspend");
    await notificationMatching(session, frame, /Suspended orders-weekly/);
    expect((await get(`${NS}/scheduledbackups/orders-weekly`))?.spec?.suspend).toBe(true);
  });

  it("pauses the pooler orders-ro from its menu, then starts it from its drawer", async () => {
    await rowMenu("poolers", "orders-ro", "Pause");
    await confirmDialog(session, frame, "Pause");
    await notificationMatching(session, frame, /Paused orders-ro/);
    expect((await get(`${NS}/poolers/orders-ro`))?.spec?.pgbouncer?.paused).toBe(true);

    await openRow("poolers", "orders-ro", "cnpg-pooler");
    await icon("play_arrow");
    await confirmDialog(session, frame, "Start");
    await notificationMatching(session, frame, /Started orders-ro/);
    expect((await get(`${NS}/poolers/orders-ro`))?.spec?.pgbouncer?.paused).toBe(false);
  });

  it("reloads two ticked clusters from the list", async () => {
    const before = await Promise.all(
      ["billing-db", "inventory-db"].map(
        async (name) => (await cluster(name))?.metadata?.annotations?.["cnpg.io/reloadedAt"],
      ),
    );

    await showList("clusters");
    for (const name of ["billing-db", "inventory-db"]) {
      await js(
        `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr')].find((row) => row.textContent.startsWith(${JSON.stringify(name)}))?.querySelector(".CNPG-table__check input").click()`,
      );
    }
    await clickByText(session, frame, '[data-section="selection"] button', "Reload");
    await confirmDialog(session, frame, "Reload 2", "confirm");
    await notificationMatching(session, frame, /Reloaded 2 of 2/);

    for (const [index, name] of ["billing-db", "inventory-db"].entries()) {
      expect((await cluster(name))?.metadata?.annotations?.["cnpg.io/reloadedAt"]).not.toBe(
        before[index],
      );
      await restore(session, frame, "PATCH", `${NS}/clusters/${name}`, {
        metadata: { annotations: { "cnpg.io/reloadedAt": null } },
      });
    }
  });

  it("left orders-db-3 with its replay paused, as seeded", async () => {
    const status = await get(`${PODS}/https:orders-db-3:8000/proxy/pg/status`);

    if (!status?.replayPaused) {
      await execIn(session, frame, "databases", "orders-db-3", "postgres", [
        "psql",
        "-At",
        "-c",
        "select pg_wal_replay_pause()",
      ]);
    }

    expect(status?.replayPaused).toBe(true);
  });
});
