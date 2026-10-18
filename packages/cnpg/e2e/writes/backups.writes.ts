import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { clickWhenShown, openWorkbench, pressChip, waitFor } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { cnpgWrites, NS } from "../support/cnpg";

describe("CloudNativePG writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { js, get, backups, icon, showList, openCluster, rowMenu, putBack } = cnpgWrites(() => ({
    session,
    frame,
  }));

  // react-select opens on a pointer sequence and closes on a protocol round-trip: one routine.
  const pickCluster = async (key: string) => {
    const outcome = await js<string>(
      `(async () => {
        const fire = (element) => {
          for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
            element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
          }
        };
        const control = document.querySelector('.ConfirmDialog [class*="Select__control"]');
        if (!control) return "no cluster select";
        const id = control.querySelector("input")?.id;
        fire(control);
        for (let attempt = 0; attempt < 25; attempt++) {
          const wanted = [...document.querySelectorAll('[id*="-' + id + '-option-"]')]
            .find((each) => each.textContent.trim() === ${JSON.stringify(key)});
          if (wanted) { fire(wanted); return "picked"; }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return "no such option";
      })()`,
    );

    if (outcome !== "picked") throw new Error(`could not pick ${key}: ${outcome}`);
    await waitFor(`the select to show ${key}`, async () =>
      (await js<string>(
        `document.querySelector('.ConfirmDialog [class*="Select__single-value"]')?.textContent?.trim() ?? ""`,
      )) === key
        ? true
        : undefined,
    );
  };

  /** A backup the test started: completed, then deleted so the list stays the seed's. */
  const backupCompletes = async (prefix: string, since: number) => {
    const created = await untilCluster(`a backup named ${prefix}-*`, async () =>
      (await backups()).find(
        (each) =>
          each.metadata.name.startsWith(`${prefix}-`) &&
          Date.parse(each.metadata.creationTimestamp) >= since - 1000,
      ),
    );

    putBack(() => restore(session, frame, "DELETE", `${NS}/backups/${created.metadata.name}`));
    await untilCluster(`${created.metadata.name} to complete`, async () => {
      const phase = (await get(`${NS}/backups/${created.metadata.name}`))?.status?.phase;
      if (phase === "failed") throw new Error(`${created.metadata.name} failed`);
      return phase === "completed";
    });

    return created;
  };

  it("backs up orders-db from its drawer, from a standby", async () => {
    const since = Date.now();

    await openCluster("orders-db");
    await icon("backup");
    await waitFor("the target choice", async () =>
      (await js<number>(`document.querySelectorAll(".ConfirmDialog .CNPG-filter").length`)) > 0
        ? true
        : undefined,
    );
    await pressChip(session, frame, ".ConfirmDialog .CNPG-filter", "Prefer a standby");
    await confirmDialog(session, frame, "Back up");
    await notificationMatching(session, frame, /Backup orders-db-\d+ started for orders-db/);

    const backup = await backupCompletes("orders-db", since);

    expect(backup.spec.target).toBe("prefer-standby");
    expect(backup.spec.pluginConfiguration?.name).toBe("barman-cloud.cloudnative-pg.io");
  });

  it("backs up orders-db from the Backups page", async () => {
    const since = Date.now();

    await showList("backups");
    await clickWhenShown(session, frame, ".CNPG-page__actions button", "Back up");
    await waitFor("the cluster choice", async () =>
      (await js<number>(
        `document.querySelectorAll('.ConfirmDialog [class*="Select__control"]').length`,
      )) > 0
        ? true
        : undefined,
    );
    await pickCluster("databases/orders-db");
    await confirmDialog(session, frame, "Back up");
    await notificationMatching(session, frame, /Backup orders-db-\d+ started for orders-db/);

    expect((await backupCompletes("orders-db", since)).spec.target).toBeUndefined();
  });

  it("backs up now as the orders-hourly schedule would, from its menu", async () => {
    const since = Date.now();

    await rowMenu("schedules", "orders-hourly", "Back up now");
    await confirmDialog(session, frame, "Back up");
    await notificationMatching(session, frame, /Backup orders-hourly-\d+ started for orders-db/);

    const backup = await backupCompletes("orders-hourly", since);
    const schedule = await get(`${NS}/scheduledbackups/orders-hourly`);

    // Labelled as the operator labels its own runs, so the schedule's verdict sees this one.
    expect(backup.metadata.labels?.["cnpg.io/scheduled-backup"]).toBe("orders-hourly");
    expect(backup.spec.method).toBe(schedule?.spec?.method ?? "barmanObjectStore");
    expect(backup.spec.pluginConfiguration?.name).toBe(schedule?.spec?.pluginConfiguration?.name);
  });
});
