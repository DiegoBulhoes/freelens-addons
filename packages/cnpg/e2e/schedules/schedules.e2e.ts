import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickSidebar,
  countOf,
  dialogText,
  type ErrorLog,
  leaveNothingBehind,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { cnpgHelpers, DRAWER } from "../support/cnpg";

// Read-only: every write is cancelled at its confirmation, or confirmed with the wrong name.

describe("opening a row of each list", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { closeDrawer } = cnpgHelpers(() => ({ session, frame }));

  it("lists the backups a schedule started", async () => {
    await clickSidebar(session, frame, "cnpg-schedules", "cnpg");
    await waitFor("the schedules", async () =>
      (await countOf(session, frame, '[data-section="cnpg-schedules"] tbody tr')) > 0
        ? true
        : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-schedules"] tbody tr')].find((row) => row.textContent.includes("Active"))?.querySelector("td:nth-child(2)").click()`,
      frame,
    );

    const started = await waitFor("its backups", async () => {
      const count = await countOf(
        session,
        frame,
        `${DRAWER} [data-section="cnpg-schedule-backups"] .CNPG-row`,
      );

      return count > 0 ? count : undefined;
    });

    expect(started).toBeGreaterThan(0);
    await closeDrawer("cnpg-schedule");
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});

describe("the CloudNativePG controls", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  const { fromRowMenu } = cnpgHelpers(() => ({ session, frame }));

  it.each([
    ["cnpg-schedules", "orders-hourly", "Suspend", /Suspend schedule orders-hourly\?/],
    ["cnpg-schedules", "orders-weekly", "Start", /Start schedule orders-weekly\?/],
    [
      "cnpg-schedules",
      "orders-hourly",
      "Back up now",
      /Back up orders-db now, as orders-hourly would\?/,
    ],
    ["cnpg-poolers", "orders-rw", "Pause", /Pause pooler orders-rw\?/],
  ] as const)(
    "asks before %s %s: %s, in the theme",
    async (page, row, item, says) => {
      await clickSidebar(session, frame, page, "cnpg");
      await waitFor(`${page}'s rows`, async () =>
        (await countOf(session, frame, `[data-section="${page}"] tbody tr`)) > 0 ? true : undefined,
      );
      await fromRowMenu(page, row, item);

      expect(await dialogText(session, frame)).toMatch(says);
      expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

      await cancelDialog(session, frame);
    },
    60_000,
  );

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
