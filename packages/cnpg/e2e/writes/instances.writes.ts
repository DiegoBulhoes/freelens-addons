import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { clickWhenShown, openWorkbench, pressChip, waitFor } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  execIn,
  notificationMatching,
  untilCluster,
} from "../../../../build/e2e/writes";
import { cnpgWrites, DRAWER, PODS } from "../support/cnpg";

// orders-db-3 keeps its replay paused, the seed's lag: nothing here restarts or promotes it, and
// the last test checks the pause survived. Restarts use inventory-db and billing-db.
describe("CloudNativePG writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { js, get, cluster, podsOf, healthy, icon, openCluster, instanceMenu, putBack, patch } =
    cnpgWrites(() => ({ session, frame }));

  const postmasterStart = async (pod: string) =>
    (
      await session.evaluate<string>(
        `fetch("/api-kube${PODS}/${pod}:9187/proxy/metrics").then((response) => response.text())`,
        frame,
      )
    ).match(/^cnpg_pg_postmaster_start_time\S*\s+(\S+)/m)?.[1];

  const switchBack = async () => {
    await untilCluster("orders-db healthy", () => healthy("orders-db"), 10 * 60_000);
    await patch("clusters/orders-db/status", {
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
  };

  it("switches orders-db over to orders-db-1, and back to orders-db-2", async () => {
    await untilCluster("orders-db healthy", () => healthy("orders-db"), 10 * 60_000);

    putBack(async () => {
      if ((await cluster("orders-db"))?.status?.currentPrimary !== "orders-db-2") {
        await switchBack();
      }
      // A switchover drops orders-sub's logical slot; the seed creates it again, and so must we.
      await execIn(session, frame, "databases", "orders-db-2", "postgres", [
        "psql",
        "-At",
        "-d",
        "app",
        "-c",
        "select pg_create_logical_replication_slot('orders_sub', 'pgoutput') where not exists (select from pg_replication_slots where slot_name = 'orders_sub')",
      ]);
    });
    await openCluster("orders-db");
    await icon("swap_horiz");
    await waitFor("the replica choice", async () =>
      (await js<number>(`document.querySelectorAll(".ConfirmDialog .CNPG-filter").length`)) > 0
        ? true
        : undefined,
    );
    await pressChip(session, frame, ".ConfirmDialog .CNPG-filter", "orders-db-1");
    await confirmDialog(session, frame, "Switch over", "orders-db");
    await notificationMatching(session, frame, /Switchover of orders-db to orders-db-1 started/);

    await untilCluster(
      "orders-db-1 primary",
      async () =>
        (await cluster("orders-db"))?.status?.currentPrimary === "orders-db-1" &&
        healthy("orders-db"),
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
    await clickWhenShown(
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

  it("left orders-sub's logical slot on the primary, as seeded", async () => {
    const primary: string = (await cluster("orders-db"))?.status?.currentPrimary;
    const slots = await execIn(session, frame, "databases", primary, "postgres", [
      "psql",
      "-At",
      "-c",
      "select count(*) from pg_replication_slots where slot_name = 'orders_sub'",
    ]);

    expect(primary).toBe("orders-db-2");
    expect(slots.trim()).toBe("1");
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
