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
    id: "redis-overview",
    headline: /Redis objects?(, all healthy| needs? attention)/,
    rows: ".Redis-row",
  },
  {
    id: "redis-replications",
    headline: /^Replications/,
    rows: '[data-section="redis-replications"] tbody tr',
  },
  { id: "redis-clusters", headline: /^Clusters/, rows: '[data-section="redis-clusters"] tbody tr' },
  {
    id: "redis-standalones",
    headline: /^Standalones/,
    rows: '[data-section="redis-standalones"] tbody tr',
  },
  {
    id: "redis-sentinels",
    headline: /^Sentinels/,
    rows: '[data-section="redis-sentinels"] tbody tr',
  },
];

describe("every page the Redis extension registers renders", () => {
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
      await clickSidebar(session, frame, page.id, "redis");

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
      expect(await textOf(session, frame, ".Redis-page__headline")).toMatch(page.headline);
    }, 60_000);
  }

  it("names each replication's master and its sentinels", async () => {
    await clickSidebar(session, frame, "redis-replications", "redis");

    const cells = await waitFor("a master", async () => {
      const found = await session.evaluate<string[][]>(
        `(() => {
          const section = '[data-section="redis-replications"]';
          const heads = [...document.querySelectorAll(section + " th")].map((each) => each.textContent.trim());
          return [...document.querySelectorAll(section + " tbody tr")].map((row) => [row.children[heads.indexOf("Master")]?.textContent.trim(), row.children[heads.indexOf("Sentinels")]?.textContent.trim()]);
        })()`,
        frame,
      );

      return found.some(([master]) => /-\d+$/.test(master ?? "")) ? found : undefined;
    });

    expect(
      cells.some(
        ([master, sentinels]) => /-\d+$/.test(master ?? "") && (sentinels ?? "") !== "None",
      ),
    ).toBe(true);
  }, 60_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
