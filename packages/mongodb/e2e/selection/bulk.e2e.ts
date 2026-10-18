import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";

// Read-only: each bulk write is cancelled, or confirmed with the wrong word.

const LIST = '[data-section="mongodb-clusters"]';
const PATH = "/apis/mongodbcommunity.mongodb.com/v1/mongodbcommunity";

describe("ticking several clusters", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const open = async () => {
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("the clusters", async () =>
      (await countOf(session, frame, `${LIST} tbody tr`)) > 1 ? true : undefined,
    );
  };

  const tickAll = () =>
    session.evaluate(
      `document.querySelector('${LIST} thead .MongoDB-table__check input').click()`,
      frame,
    );

  it("offers Restart and Delete once rows are ticked, without opening a drawer", async () => {
    await open();
    await session.evaluate(
      `document.querySelector('${LIST} tbody .MongoDB-table__check input').click()`,
      frame,
    );

    const labels = await waitFor("the selection bar", async () => {
      const found = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="selection"] button')].map((each) => each.textContent.trim())`,
        frame,
      );

      return found.length > 0 ? found : undefined;
    });

    expect(labels).toEqual(["Restart", "Delete"]);
    expect(
      await countOf(session, frame, '.MongoDBObjectDrawer [data-section="mongodb-cluster"]'),
    ).toBe(0);
    expect(await designViolations(session, frame, "MongoDB")).toEqual([]);

    await session.evaluate(
      `document.querySelector('${LIST} tbody .MongoDB-table__check input').click()`,
      frame,
    );
  }, 60_000);

  it("names the sets a restart skips, and why", async () => {
    await open();
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(/Restart \d+ clusters?\?/);
    expect(dialog).toMatch(/Skipped: .*not running/);
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    await cancelDialog(session, frame);
    await tickAll();
  }, 60_000);

  it("deletes nothing when the wrong word is typed", async () => {
    const names = async () =>
      (await clusterItems<{ metadata: { uid: string } }>(session, frame, PATH))
        .map((each) => each.metadata.uid)
        .sort();
    const before = await names();

    await open();
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Delete");

    expect(await dialogText(session, frame)).toMatch(/Delete \d+ clusters\?/);
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await session.evaluate(
      `[...document.querySelectorAll('.ConfirmDialog button')].find((each) => each.textContent.startsWith("Delete"))?.click()`,
      frame,
    );

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();
    expect(await names()).toEqual(before);
    await tickAll();
  }, 60_000);
  it("does all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
