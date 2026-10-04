import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: each bulk write is cancelled, or confirmed with the wrong word.

const LIST = '[data-section="mongodb-clusters"]';
const PATH = "/apis/mongodbcommunity.mongodb.com/v1/mongodbcommunity";

describe("ticking several clusters", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const open = async () => {
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("the clusters", async () =>
      (await countOf(`${LIST} tbody tr`)) > 1 ? true : undefined,
    );
  };

  const tickAll = () =>
    session.evaluate(
      `document.querySelector('${LIST} thead .MongoDB-table__check input').click()`,
      frame,
    );

  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

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
    expect(await countOf('.MongoDBObjectDrawer [data-section="mongodb-cluster"]')).toBe(0);
    expect(await designViolations(session, frame, "MongoDB")).toEqual([]);

    await session.evaluate(
      `document.querySelector('${LIST} tbody .MongoDB-table__check input').click()`,
      frame,
    );
  }, 60_000);

  it("names the sets a restart skips, and why", async () => {
    await open();
    await tickAll();
    await clickByText(session, frame, '[data-section="selection"] button', "Restart");

    const dialog = await dialogText();

    expect(dialog).toMatch(/Restart \d+ clusters?\?/);
    expect(dialog).toMatch(/Skipped: .*not running/);
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
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
    await clickByText(session, frame, '[data-section="selection"] button', "Delete");

    expect(await dialogText()).toMatch(/Delete \d+ clusters\?/);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await session.evaluate(
      `[...document.querySelectorAll('.ConfirmDialog button')].find((each) => each.textContent.startsWith("Delete"))?.click()`,
      frame,
    );

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();
    expect(await names()).toEqual(before);
    await tickAll();
  }, 60_000);
});
