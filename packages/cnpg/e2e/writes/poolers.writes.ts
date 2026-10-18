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

  const { get, icon, openRow, rowMenu, putBack, patch } = cnpgWrites(() => ({ session, frame }));

  it("pauses the pooler orders-ro from its menu, then starts it from its drawer", async () => {
    putBack(() => patch("poolers/orders-ro", { spec: { pgbouncer: { paused: false } } }));
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
});
