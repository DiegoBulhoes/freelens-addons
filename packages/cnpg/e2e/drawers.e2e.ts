import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations } from "../../../build/e2e/design";
import { clickSidebar, hoverForTooltip, openWorkbench, waitFor } from "../../../build/e2e/freelens";

const DRAWER = ".CNPGObjectDrawer";

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

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const openFirst = async (page: string, section: string) => {
    await clickSidebar(session, frame, page, "cnpg");
    await waitFor(`${page}'s rows`, async () =>
      (await countOf(`[data-section="${page}"] tbody tr`)) > 0 ? true : undefined,
    );
    // The second cell: the first holds the row's checkbox, which opens nothing.
    await session.evaluate(
      `document.querySelector('[data-section="${page}"] tbody tr td:nth-child(2)').click()`,
      frame,
    );
    await waitFor(`${section}'s drawer`, async () =>
      (await countOf(`${DRAWER} [data-section="${section}"]`)) > 0 ? true : undefined,
    );
  };

  const closeDrawer = (section: string) =>
    session
      .evaluate(
        `[...document.querySelectorAll('${DRAWER} .drawer-title i.Icon')].find((each) => each.textContent.trim() === "close")?.click()`,
        frame,
      )
      .then(() =>
        waitFor("the drawer to close", async () =>
          (await countOf(`${DRAWER} [data-section="${section}"]`)) === 0 ? true : undefined,
        ),
      );

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

  it("lists the backups a schedule started", async () => {
    await clickSidebar(session, frame, "cnpg-schedules", "cnpg");
    await waitFor("the schedules", async () =>
      (await countOf('[data-section="cnpg-schedules"] tbody tr')) > 0 ? true : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-schedules"] tbody tr')].find((row) => row.textContent.includes("Active"))?.querySelector("td:nth-child(2)").click()`,
      frame,
    );

    const started = await waitFor("its backups", async () => {
      const count = await countOf(`${DRAWER} [data-section="cnpg-schedule-backups"] .CNPG-row`);

      return count > 0 ? count : undefined;
    });

    expect(started).toBeGreaterThan(0);
    await closeDrawer("cnpg-schedule");
  }, 60_000);

  it("follows a row's cluster link to the cluster, without opening the row", async () => {
    await clickSidebar(session, frame, "cnpg-poolers", "cnpg");
    await waitFor("the poolers", async () =>
      (await countOf('[data-section="cnpg-poolers"] tbody tr')) > 0 ? true : undefined,
    );
    await session.evaluate(
      `document.querySelector('[data-section="cnpg-poolers"] tbody tr .CNPG-link').click()`,
      frame,
    );

    expect(
      await waitFor("the clusters list", async () =>
        (await countOf('[data-section="cnpg-clusters"]')) > 0 ? true : undefined,
      ),
    ).toBe(true);
    expect(await countOf(`${DRAWER} [data-section="cnpg-pooler"]`)).toBe(0);
  }, 60_000);
});
