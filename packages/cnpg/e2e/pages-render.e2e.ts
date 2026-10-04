import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  type ConsoleError,
  clickSidebar,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

// Counts are "more than none": a number would be the dev cluster's contents.

const PAGES: { id: string; headline: RegExp; rows: string }[] = [
  {
    id: "cnpg-overview",
    headline: /\d+ of \d+ Postgres clusters need attention|ready and backed up/,
    rows: ".CNPG-row",
  },
  {
    id: "cnpg-clusters",
    headline: /^Postgres clusters/,
    rows: '[data-section="cnpg-clusters"] tbody tr',
  },
  { id: "cnpg-backups", headline: /^Backups/, rows: '[data-section="cnpg-backups"] tbody tr' },
  {
    id: "cnpg-schedules",
    headline: /^Scheduled backups/,
    rows: '[data-section="cnpg-schedules"] tbody tr',
  },
  { id: "cnpg-poolers", headline: /^Poolers/, rows: '[data-section="cnpg-poolers"] tbody tr' },
  {
    id: "cnpg-logical",
    headline: /^Logical replication/,
    rows: '[data-section="cnpg-logical"] tbody tr',
  },
];

describe("every page the CloudNativePG extension registers renders", () => {
  let session: Session;
  let frame: number;
  let errors: { drain: () => ConsoleError[] };

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  for (const page of PAGES) {
    it(`opens ${page.id}, with rows`, async () => {
      await clickSidebar(session, frame, page.id, "cnpg");

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
      expect(await textOf(session, frame, ".CNPG-page__headline")).toMatch(page.headline);
    }, 60_000);
  }

  it("lists each cluster's replicas beside its primary", async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");

    const headers = await session.evaluate<string[]>(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] th')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(headers.indexOf("Replicas")).toBe(headers.indexOf("Primary") + 1);
  }, 60_000);

  it("says why archiving fails, in barman's words rather than an exit status", async () => {
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");

    const row = await waitFor("a failing row with its cause", async () => {
      const text = await session.evaluate<string>(
        `[...document.querySelectorAll('.CNPG-row')].find((each) => each.textContent.includes("Archiving failing") && each.textContent.includes("Cause:"))?.textContent ?? ""`,
        frame,
      );

      return text || undefined;
    });
    const cause = row.slice(row.indexOf("Cause:") + "Cause:".length).trim();

    expect(cause.length).toBeGreaterThan(0);
    expect(cause).not.toMatch(/exit status/);

    await clickSidebar(session, frame, "cnpg-schedules", "cnpg");

    const cell = await waitFor("the failing schedule's cause", async () => {
      const text = await session.evaluate<string>(
        `[...document.querySelectorAll('[data-section="cnpg-schedules"] tbody tr')].find((each) => each.textContent.includes("Last run failed"))?.textContent ?? ""`,
        frame,
      );

      return text.includes(cause) ? text : undefined;
    });

    expect(cell).toContain(cause);
  }, 60_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
