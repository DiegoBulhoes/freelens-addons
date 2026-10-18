import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  pressChip,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";

// Counts are "more than none": a number would be the dev cluster's contents.

const ATTENTION = '[data-section="redis-attention"]';
const CARDS = '[data-section="redis-cards"] .Redis-card';

const PAGES: { id: string; headline: RegExp; rows: string }[] = [
  {
    id: "redis-overview",
    // The seed fails broken-cache and legacy-store: "all healthy" would be wrong.
    headline: /Redis objects? needs? attention/,
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
  let errors: ErrorLog;

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
      // Rows show before their pods are read, under a passing "pods not read yet".
      expect(
        await waitFor(`${page.id}'s headline`, async () => {
          const text = await textOf(session, frame, ".Redis-page__headline");

          return page.headline.test(text) ? text : undefined;
        }),
      ).toMatch(page.headline);
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

  it("ranks each failing object the seed makes, by name, under Needs attention", async () => {
    await clickSidebar(session, frame, "redis-overview", "redis");

    const critical = await waitFor("the seed's failing objects", async () => {
      const names = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="redis-attention"] .Redis-row--critical b')].map((each) => each.textContent)`,
        frame,
      );

      return names.includes("broken-cache") && names.includes("legacy-store") ? names : undefined;
    });

    expect(critical).toEqual(expect.arrayContaining(["broken-cache", "legacy-store"]));
    expect(critical).not.toContain("cache");
  }, 60_000);

  it("says why each failing object is stuck, from its pod and its volume", async () => {
    await clickSidebar(session, frame, "redis-overview", "redis");

    const reasons = await waitFor("the seed's causes", async () => {
      const found = await session.evaluate<Record<string, string>>(
        `Object.fromEntries([...document.querySelectorAll('${ATTENTION} .Redis-row')].map((row) => [row.querySelector("b")?.textContent, row.querySelector(".Redis-row__reason")?.textContent]))`,
        frame,
      );

      return /v9\.9\.999/.test(found["broken-cache"] ?? "") &&
        /not bound/.test(found["legacy-store"] ?? "")
        ? found
        : undefined;
    });

    expect(reasons["broken-cache"]).toMatch(/v9\.9\.999/);
    expect(reasons["legacy-store"]).toMatch(
      /legacy-store-legacy-store-0 is not bound \(storage class no-such-class\)/,
    );
  }, 60_000);

  const cardValue = (label: string) =>
    session.evaluate<number>(
      `Number([...document.querySelectorAll('${CARDS}')].find((each) => each.querySelector(".Redis-card__label")?.textContent === ${JSON.stringify(label)})?.querySelector(".Redis-card__value")?.textContent ?? -1)`,
      frame,
    );

  it("narrows Needs attention to what the Down or failed card counts", async () => {
    await clickSidebar(session, frame, "redis-overview", "redis");
    await waitFor("the failing objects", async () =>
      (await cardValue("Down or failed")) > 0 ? true : undefined,
    );
    await clickWhenShown(session, frame, CARDS, "Down or failed");

    try {
      const shown = await waitFor("the Down or failed chip", async () => {
        const found = await session.evaluate<{ pressed: string; tones: string[] }>(
          `({
            pressed: document.querySelector('${ATTENTION} .Redis-filter[aria-pressed="true"]')?.textContent ?? "",
            tones: [...document.querySelectorAll('${ATTENTION} .Redis-row')].map((each) => each.className),
          })`,
          frame,
        );

        return found.pressed === "Down or failed" ? found.tones : undefined;
      });

      expect(shown.length).toBe(await cardValue("Down or failed"));
      expect(shown.every((each) => each.includes("Redis-row--critical"))).toBe(true);
    } finally {
      await pressChip(session, frame, `${ATTENTION} .Redis-filter`, "All");
    }
  }, 60_000);

  it("opens the Replications list on those no sentinel watches, from its card", async () => {
    await clickSidebar(session, frame, "redis-overview", "redis");

    const counted = await waitFor("the unwatched card", async () => {
      const value = await cardValue("Replications no sentinel watches");

      return value > 0 ? value : undefined;
    });

    await clickWhenShown(session, frame, CARDS, "Replications no sentinel watches");

    const names = await waitFor("the No sentinel chip", async () => {
      const found = await session.evaluate<{ pressed: string; names: string[] }>(
        `({
          pressed: document.querySelector('.Redis-filter[aria-pressed="true"]')?.textContent ?? "",
          names: [...document.querySelectorAll('[data-section="redis-replications"] tbody tr')].map((row) => (row.querySelector("td:not(.Redis-table__check)")?.textContent ?? "").split(" · ")[0]),
        })`,
        frame,
      );

      return found.pressed === "No sentinel" && found.names.length > 0 ? found.names : undefined;
    });

    expect(names).toHaveLength(counted);
    expect(names).toContain("broken-cache");
    expect(names).not.toContain("cache");
  }, 60_000);

  it("opens a failing object's drawer from its row under Needs attention", async () => {
    await clickSidebar(session, frame, "redis-overview", "redis");
    await waitFor("broken-cache's row", async () =>
      (await session.evaluate<boolean>(
        `[...document.querySelectorAll('${ATTENTION} .Redis-row b')].some((each) => each.textContent === "broken-cache")`,
        frame,
      ))
        ? true
        : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('${ATTENTION} .Redis-row')].find((row) => row.querySelector("b")?.textContent === "broken-cache")?.click()`,
      frame,
    );

    expect(
      await waitFor("broken-cache's drawer", async () => {
        const title = await drawerTitle(session, frame, ".RedisObjectDrawer");

        return title === "Replication: broken-cache" ? title : undefined;
      }),
    ).toBe("Replication: broken-cache");
  }, 60_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
