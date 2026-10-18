import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { clickWhenShown, openWorkbench, pressChip } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  type KubeObject,
  notificationMatching,
  untilCluster,
} from "../../../../build/e2e/writes";
import { cnpgWrites, DRAWER } from "../support/cnpg";

describe("CloudNativePG writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { js, get, cluster, podsOf, healthy, icon, showList, openCluster, putBack, patch, undo } =
    cnpgWrites(() => ({ session, frame }));

  const unreloaded = (name: string) => () =>
    patch(`clusters/${name}`, { metadata: { annotations: { "cnpg.io/reloadedAt": null } } });
  const hibernation = (name: string, value: "on" | "off") => async () => {
    if ((await cluster(name))?.metadata?.annotations?.["cnpg.io/hibernation"] !== value) {
      await patch(`clusters/${name}`, {
        metadata: { annotations: { "cnpg.io/hibernation": value } },
      });
    }
  };

  it("reloads inventory-db: the annotation moves and no pod restarts", async () => {
    const before = (await cluster("inventory-db"))?.metadata?.annotations?.["cnpg.io/reloadedAt"];
    const uids = (await podsOf("inventory-db")).map((each) => each.metadata.uid);

    putBack(unreloaded("inventory-db"));
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

  it("hibernates inventory-db, keeping its volume, then wakes it", async () => {
    putBack(hibernation("inventory-db", "off"));
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
    putBack(hibernation("reports-db", "on"));
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

    putBack(() => patch("clusters/billing-db", { spec: { nodeMaintenanceWindow: before } }));
    await openCluster("billing-db");
    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-maintenance"] button`,
      "Start window",
    );
    await pressChip(session, frame, ".ConfirmDialog .CNPG-filter", "Rebuild elsewhere");
    await confirmDialog(session, frame, "Start");
    await notificationMatching(session, frame, /Maintenance window of billing-db started/);
    expect((await cluster("billing-db"))?.spec?.nodeMaintenanceWindow).toMatchObject({
      inProgress: true,
      reusePVC: false,
    });

    await openCluster("billing-db");
    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-maintenance"] button`,
      "End window",
    );
    await confirmDialog(session, frame, "End");
    await notificationMatching(session, frame, /Maintenance window of billing-db ended/);
    expect((await cluster("billing-db"))?.spec?.nodeMaintenanceWindow?.inProgress).toBe(false);
  });

  it("reloads two ticked clusters from the list", async () => {
    const before = await Promise.all(
      ["billing-db", "inventory-db"].map(
        async (name) => (await cluster(name))?.metadata?.annotations?.["cnpg.io/reloadedAt"],
      ),
    );

    for (const name of ["billing-db", "inventory-db"]) putBack(unreloaded(name));
    await showList("clusters");
    for (const name of ["billing-db", "inventory-db"]) {
      await js(
        `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr')].find((row) => row.textContent.startsWith(${JSON.stringify(name)}))?.querySelector(".CNPG-table__check input").click()`,
      );
    }
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Reload");
    await confirmDialog(session, frame, "Reload 2", "confirm");
    await notificationMatching(session, frame, /Reloaded 2 of 2/);

    for (const [index, name] of ["billing-db", "inventory-db"].entries()) {
      expect((await cluster(name))?.metadata?.annotations?.["cnpg.io/reloadedAt"]).not.toBe(
        before[index],
      );
    }
  });
});
