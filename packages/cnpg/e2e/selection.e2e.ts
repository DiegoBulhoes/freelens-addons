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

const PAGES: [page: string, actions: string[]][] = [
  ["cnpg-clusters", ["Back up", "Reload", "Wake", "Hibernate", "Restart"]],
  ["cnpg-backups", ["Delete"]],
  ["cnpg-schedules", ["Back up now", "Start", "Suspend", "Delete"]],
  ["cnpg-poolers", ["Start", "Pause", "Delete"]],
  ["cnpg-logical", ["Delete"]],
];

describe("ticking several rows", () => {
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

  const open = async (page: string) => {
    await clickSidebar(session, frame, page, "cnpg");
    await waitFor(`${page}'s rows`, async () =>
      (await countOf(`[data-section="${page}"] tbody tr`)) > 1 ? true : undefined,
    );
  };

  /** Ticks the first `count` rows by their own checkbox, as a person would. */
  const tick = (page: string, count: number) =>
    session.evaluate(
      `[...document.querySelectorAll('[data-section="${page}"] tbody .CNPG-table__check input')].slice(0, ${count}).forEach((box) => box.click())`,
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

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  it.each(PAGES)(
    "offers %s's bulk actions once rows are ticked, each with a tooltip",
    async (page, actions) => {
      await open(page);

      expect(await countOf('[data-section="selection"]')).toBe(0);

      await tick(page, 2);

      const bar = await waitFor("the selection bar", async () => {
        const text = await session.evaluate<string>(
          `document.querySelector('[data-section="selection"]')?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(bar).toMatch(/2 selected/);

      const labels = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="selection"] button')].map((each) => each.textContent.trim())`,
        frame,
      );

      expect(labels).toEqual(actions);
      expect(await countOf(`[data-section="${page}"] tbody .CNPG-table__row--selected`)).toBe(2);
      expect(await designViolations(session, frame, "CNPG")).toEqual([]);

      await tick(page, 2);
      await waitFor("the bar to go once nothing is ticked", async () =>
        (await countOf('[data-section="selection"]')) === 0 ? true : undefined,
      );
    },
    60_000,
  );

  it("ticks a cluster without opening its drawer", async () => {
    await open("cnpg-clusters");
    await tick("cnpg-clusters", 1);
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(await countOf('.CNPGObjectDrawer [data-section="cnpg-cluster"]')).toBe(0);

    await tick("cnpg-clusters", 1);
  }, 60_000);

  it("asks for confirm before backing up every cluster, naming those it skips and why", async () => {
    await open("cnpg-clusters");
    await session.evaluate(
      `document.querySelector('[data-section="cnpg-clusters"] thead .CNPG-table__check input').click()`,
      frame,
    );
    await clickByText(session, frame, '[data-section="selection"] button', "Back up");

    const dialog = await dialogText();

    expect(dialog).toMatch(/Back up \d+ clusters?\?/);
    expect(dialog).toMatch(/Skipped: .*no backup method configured/);
    expect(dialog).toMatch(/Type confirm to confirm/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await cancelDialog();
    await session.evaluate(
      `document.querySelector('[data-section="cnpg-clusters"] thead .CNPG-table__check input').click()`,
      frame,
    );
  }, 60_000);

  it("deletes no backup when the wrong word is typed", async () => {
    const path = "/apis/postgresql.cnpg.io/v1/backups";
    const before = (await clusterItems<{ metadata: { uid: string } }>(session, frame, path))
      .map((each) => each.metadata.uid)
      .sort();

    await open("cnpg-backups");
    await tick("cnpg-backups", 2);
    await clickByText(session, frame, '[data-section="selection"] button', "Delete");

    expect(await dialogText()).toMatch(/Delete 2 backups\?/);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickByText(session, frame, ".ConfirmDialog button", "Delete 2");

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();

    const after = (await clusterItems<{ metadata: { uid: string } }>(session, frame, path))
      .map((each) => each.metadata.uid)
      .sort();

    expect(after).toEqual(before);
    await tick("cnpg-backups", 2);
  }, 60_000);

  it.each([
    ["cnpg-clusters", /^\d+(\.\d+)?$/],
    ["cnpg-backups", /^\d+$/],
  ])(
    "shows the Postgres version on %s",
    async (page, pattern) => {
      await open(page);

      const versions = await session.evaluate<string[]>(
        `(() => {
        const headers = [...document.querySelectorAll('[data-section="${page}"] th')].map((each) => each.textContent.trim());
        const at = headers.indexOf("Postgres");
        return at < 0 ? [] : [...document.querySelectorAll('[data-section="${page}"] tbody tr')].map((row) => row.children[at]?.textContent.trim() ?? "");
      })()`,
        frame,
      );

      expect(versions.length).toBeGreaterThan(0);
      expect(versions.filter((each) => each !== "—").every((each) => pattern.test(each))).toBe(
        true,
      );
      expect(versions.some((each) => pattern.test(each))).toBe(true);
    },
    60_000,
  );
});
