import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  leaveNothingBehind,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { cnpgHelpers } from "../support/cnpg";

// Read-only: every write is cancelled at its confirmation, or confirmed with the wrong name.

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
    ["cnpg-backups", "orders-hourly-", "/apis/postgresql.cnpg.io/v1/backups"],
    ["cnpg-schedules", "orders-hourly", "/apis/postgresql.cnpg.io/v1/scheduledbackups"],
    ["cnpg-poolers", "orders-rw", "/apis/postgresql.cnpg.io/v1/poolers"],
    ["cnpg-logical", "orders-pub", "/apis/postgresql.cnpg.io/v1/publications"],
    ["cnpg-logical", "orders-sub", "/apis/postgresql.cnpg.io/v1/subscriptions"],
  ] as const)(
    "deletes nothing on %s when the wrong name is typed",
    async (page, row, path) => {
      await clickSidebar(session, frame, page, "cnpg");
      await waitFor(`${page}'s rows`, async () =>
        (await countOf(session, frame, `[data-section="${page}"] tbody tr`)) > 0 ? true : undefined,
      );

      const name = await session.evaluate<string>(
        `([...document.querySelectorAll('[data-section="${page}"] tbody tr td:not(.CNPG-table__check)')].find((cell) => cell.textContent.startsWith(${JSON.stringify(row)}))?.textContent ?? "").split(" · ")[0].trim()`,
        frame,
      );

      expect(name).not.toBe("");

      await fromRowMenu(page, name, "Delete");

      expect(await dialogText(session, frame)).toMatch(new RegExp(`Type ${name} to confirm`));
      expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
      await clickWhenShown(session, frame, ".ConfirmDialog button", "Delete");

      // An earlier "Nothing was changed" may still be on screen; wait for this one.
      expect(
        await notificationSaying(session, frame, `Nothing was changed: "${name}"`),
      ).toBeTruthy();

      const still = await clusterItems<{ metadata: { name: string } }>(session, frame, path);

      expect(still.map((each) => each.metadata.name)).toContain(name);
    },
    60_000,
  );

  it("does all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
