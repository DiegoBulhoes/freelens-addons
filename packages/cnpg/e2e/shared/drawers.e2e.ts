import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  countOf,
  type ErrorLog,
  hoverForTooltip,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { cnpgHelpers, DRAWER } from "../support/cnpg";

const PAGES: [page: string, section: string, facts: string[], icons: string[]][] = [
  [
    "cnpg-schedules",
    "cnpg-schedule",
    ["Cluster", "When", "Next run", "Method"],
    ["backup", "delete"],
  ],
  [
    "cnpg-backups",
    "cnpg-backup",
    ["Cluster", "Method", "Taken from", "WAL", "Postgres"],
    ["delete"],
  ],
  ["cnpg-poolers", "cnpg-pooler", ["Cluster", "Sends to", "Pool mode", "Service"], ["delete"]],
  [
    "cnpg-logical",
    "cnpg-logical-object",
    ["Cluster", "Database", "Name in Postgres", "On delete"],
    ["delete"],
  ],
];

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

  const openFirst = async (page: string, section: string) => {
    await clickSidebar(session, frame, page, "cnpg");
    await waitFor(`${page}'s rows`, async () =>
      (await countOf(session, frame, `[data-section="${page}"] tbody tr`)) > 0 ? true : undefined,
    );
    // The second cell: the first holds the row's checkbox, which opens nothing.
    await session.evaluate(
      `document.querySelector('[data-section="${page}"] tbody tr td:nth-child(2)').click()`,
      frame,
    );
    await waitFor(`${section}'s drawer`, async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="${section}"]`)) > 0
        ? true
        : undefined,
    );
  };

  it.each(PAGES)(
    "opens %s's drawer from a row, with its facts and its actions in the title bar",
    async (page, section, facts, icons) => {
      await openFirst(page, section);

      const terms = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="${section}"] .CNPG-facts dt')].map((each) => each.textContent)`,
        frame,
      );

      expect(terms).toEqual(expect.arrayContaining(facts));

      for (const icon of icons) {
        const present = `[...document.querySelectorAll('${DRAWER} .drawer-title i.Icon')].find((each) => each.textContent.trim() === ${JSON.stringify(icon)})`;

        expect(await session.evaluate<boolean>(`Boolean(${present})`, frame), icon).toBe(true);
        await session.evaluate(`${present}.setAttribute("data-hovered", "")`, frame);
        expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`), icon).toMatch(
          /\w/,
        );
        await session.evaluate(
          `(() => {
            const icon = document.querySelector('${DRAWER} [data-hovered]');
            for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) icon?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
            icon?.removeAttribute("data-hovered");
          })()`,
          frame,
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      expect(await designViolations(session, frame, "CNPG")).toEqual([]);
      await closeDrawer(section);
    },
    90_000,
  );

  it("draws a failing cluster's drawer from the standard", async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    // billing-db's backups fail on purpose in the seed.
    await waitFor("billing-db's row", async () =>
      (await session.evaluate<boolean>(
        `Boolean([...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr td:not(.CNPG-table__check)')].find((cell) => cell.textContent.startsWith("billing-db")))`,
        frame,
      ))
        ? true
        : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr td:not(.CNPG-table__check)')].find((cell) => cell.textContent.startsWith("billing-db")).click()`,
      frame,
    );
    await waitFor("billing-db's drawer", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-cluster"]`)) > 0
        ? true
        : undefined,
    );

    expect(await countOf(session, frame, `${DRAWER} .CNPG-status--critical`)).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "CNPG")).toEqual([]);

    await closeDrawer("cnpg-cluster");
  }, 60_000);

  it("does all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
