import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  type ErrorLog,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, openSuite, pagesOn, ROWS } from "../support/mongodb";

// Read-only: cards, chips, rows, search and links only navigate.

// The seed holds a set behind each of these; Missing a TLS Secret may have none.
const CARDS: [label: string, filter: string][] = [
  ["Down, failed or no primary", "critical"],
  ["Degraded", "degraded"],
  ["Changing version", "changing-version"],
  ["Missing a password Secret", "no-password"],
];

describe("the controls on the MongoDB pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openSuite());
  }, 180_000);

  afterAll(() => session?.close());

  const { where, activeChip } = pagesOn(() => ({ session, frame }));

  const openOverview = async () => {
    await clickSidebar(session, frame, "mongodb-overview", "mongodb");
    await waitFor(
      "the cards",
      async () => (await countOf(session, frame, "button.MongoDB-card")) > 0 || undefined,
    );
  };

  /** Presses the card with exactly this label; returns the number it shows. */
  const pressCard = async (label: string) => {
    const value = await session.evaluate<number>(
      `(() => {
        const card = [...document.querySelectorAll('button.MongoDB-card')]
          .find((each) => each.querySelector('.MongoDB-card__label')?.textContent.trim() === ${JSON.stringify(label)});
        if (!card) return -1;
        card.click();
        return Number(card.querySelector('.MongoDB-card__value').textContent);
      })()`,
      frame,
    );

    if (value < 0) throw new Error(`no card labelled ${label}`);

    return value;
  };

  const rowsToBe = async (value: number) => {
    // Read once the list has the count; a wrong count shows in the assertion, not as a timeout.
    await waitFor(
      "the rows",
      async () => ((await countOf(session, frame, ROWS)) === value ? true : undefined),
      10_000,
    ).catch(() => undefined);

    return countOf(session, frame, ROWS);
  };

  describe("the overview's cards", () => {
    it.each(CARDS)(
      "takes %s to the Clusters list on filter=%s, with as many rows as it counts",
      async (label, filter) => {
        await openOverview();

        const value = await pressCard(label);

        expect(value, `the seed has clusters behind ${label}`).toBeGreaterThan(0);
        expect(
          await waitFor(`the list behind ${label}`, async () => {
            const path = await where();

            return path.startsWith("/clusters") ? path : undefined;
          }),
        ).toContain(`filter=${filter}`);
        expect(
          await waitFor(`${label} lit`, async () =>
            (await activeChip()) === label ? label : undefined,
          ),
        ).toBe(label);
        expect(await rowsToBe(value)).toBe(value);
      },
      90_000,
    );

    it("takes Clusters to every cluster, on All", async () => {
      await openOverview();

      const value = await pressCard("Clusters");

      await waitFor("the Clusters list", async () =>
        (await where()).startsWith("/clusters") ? true : undefined,
      );
      expect(await waitFor("All lit", async () => (await activeChip()) || undefined)).toBe("All");
      expect(await rowsToBe(value)).toBe(value);
    }, 90_000);

    it("opens an attention row's own cluster in its drawer", async () => {
      await openOverview();

      const name = await session.evaluate<string>(
        `(() => {
          const row = document.querySelector('[data-section="mongodb-attention"] button.MongoDB-row');
          row?.click();
          return row?.title.replace(/^Opens /, "") ?? "";
        })()`,
        frame,
      );

      expect(name, "the seed has a cluster needing attention").not.toBe("");
      expect(
        await waitFor(`${name}'s drawer`, async () => {
          const title = await drawerTitle(session, frame, DRAWER);

          return title.startsWith("Cluster: ") ? title : undefined;
        }),
      ).toBe(`Cluster: ${name}`);
    }, 90_000);
  });

  it("does all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
