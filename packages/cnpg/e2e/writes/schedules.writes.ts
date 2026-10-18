import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { openWorkbench } from "../../../../build/e2e/freelens";
import { confirmDialog, notificationMatching } from "../../../../build/e2e/writes";
import { cnpgWrites, NS } from "../support/cnpg";

describe("CloudNativePG writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { get, icon, openRow, rowMenu, putBack, patch, undo } = cnpgWrites(() => ({
    session,
    frame,
  }));

  it("suspends orders-hourly from its menu, and Undo starts it again", async () => {
    putBack(() => patch("scheduledbackups/orders-hourly", { spec: { suspend: false } }));
    await rowMenu("schedules", "orders-hourly", "Suspend");
    await confirmDialog(session, frame, "Suspend");
    await notificationMatching(session, frame, /Suspended orders-hourly/);
    expect((await get(`${NS}/scheduledbackups/orders-hourly`))?.spec?.suspend).toBe(true);

    await undo(/Suspended orders-hourly/, "Undo");
    expect((await get(`${NS}/scheduledbackups/orders-hourly`))?.spec?.suspend).toBe(false);
  });

  it("starts the suspended orders-weekly from its drawer, then suspends it again", async () => {
    putBack(() => patch("scheduledbackups/orders-weekly", { spec: { suspend: true } }));
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
});
