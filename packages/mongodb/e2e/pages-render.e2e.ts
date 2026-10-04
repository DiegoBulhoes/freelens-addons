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
    id: "mongodb-overview",
    headline: /\d+ of \d+ clusters? needs? attention|all healthy/,
    rows: ".MongoDB-row",
  },
  {
    id: "mongodb-clusters",
    headline: /^Clusters/,
    rows: '[data-section="mongodb-clusters"] tbody tr',
  },
];

describe("every page the MongoDB extension registers renders", () => {
  let session: Session;
  let frame: number;
  let errors: { drain: () => ConsoleError[] };

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const column = (title: string) =>
    session.evaluate<string[]>(
      `(() => {
        const section = '[data-section="mongodb-clusters"]';
        const at = [...document.querySelectorAll(section + " th")].map((each) => each.textContent.trim()).indexOf(${JSON.stringify(title)});
        return at < 0 ? [] : [...document.querySelectorAll(section + " tbody tr")].map((row) => row.children[at]?.textContent.trim() ?? "");
      })()`,
      frame,
    );

  for (const page of PAGES) {
    it(`opens ${page.id}, with rows`, async () => {
      await clickSidebar(session, frame, page.id, "mongodb");

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
      expect(await textOf(session, frame, ".MongoDB-page__headline")).toMatch(page.headline);
    }, 60_000);
  }

  it("names each running set's primary, read from its members' agents", async () => {
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");

    const primaries = await waitFor("a primary", async () => {
      const found = (await column("Primary")).filter((each) => /-\d+$/.test(each));

      return found.length > 0 ? found : undefined;
    });

    expect(primaries.length).toBeGreaterThan(0);
  }, 60_000);

  it("gives the concrete cause of a stuck set, not the operator's retrying", async () => {
    await clickSidebar(session, frame, "mongodb-overview", "mongodb");

    const reasons = await waitFor("the attention rows", async () => {
      const texts = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="mongodb-attention"] .MongoDB-row__reason')].map((each) => each.textContent)`,
        frame,
      );

      return texts.length > 0 ? texts : undefined;
    });

    expect(reasons.some((each) => /not bound|ImagePullBackOff|not scheduled/i.test(each))).toBe(
      true,
    );
    expect(reasons.some((each) => /retrying in 10 seconds/.test(each))).toBe(false);
  }, 60_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
