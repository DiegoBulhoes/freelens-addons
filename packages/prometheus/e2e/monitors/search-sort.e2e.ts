import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  type ErrorLog,
  openWorkbench,
  pressSort,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { column, LISTS, MONITORS, openList, rowsOf, SEARCH, untilLive } from "../support/lists";
import { controlReads } from "../support/prometheus";

describe("the controls on the Prometheus pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { rowTexts } = controlReads(() => ({ session, frame }));

  describe("the Monitors list's search and sort", () => {
    it("narrows to a name that is on the list", async () => {
      const all = await openList(session, frame, LISTS.monitors);
      const [name = ""] = await column(session, frame, MONITORS, "Name");

      await typeInto(session, frame, SEARCH, name);

      const shown = await waitFor("the list to narrow", async () => {
        const found = await rowTexts(rowsOf(MONITORS));

        return found.length > 0 && found.every((each) => each.includes(name)) ? found : undefined;
      });

      expect(shown.length).toBeLessThanOrEqual(all);
      expect(await textOf(session, frame, ".Prometheus-page__count")).toMatch(
        /^\d+ of \d+ items?$|^\d+ items?$/,
      );
    }, 60_000);

    it("says so when nothing matches, and comes back when cleared", async () => {
      await typeInto(session, frame, SEARCH, "no-monitor-is-called-this");

      expect(
        await waitFor("the empty note", async () => {
          const text = await textOf(session, frame, `${MONITORS} .Prometheus-section__note`);

          return text.length > 0 ? text : undefined;
        }),
      ).toBe("Nothing matches the search.");

      await typeInto(session, frame, SEARCH, "");
      expect(
        await waitFor(
          "the list back",
          async () => (await countOf(session, frame, rowsOf(MONITORS))) || undefined,
        ),
      ).toBeGreaterThan(0);
    }, 60_000);

    it("sorts by a header, and cycles back to the page's own order", async () => {
      await openList(session, frame, LISTS.monitors);
      // Live reads reorder worst first; let them land before taking the page's own order.
      await untilLive(session, frame, MONITORS);

      const names = () => column(session, frame, MONITORS, "Name");
      const sortOf = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('${MONITORS} th')]
             .find((each) => each.textContent.trim() === "Name")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );
      const press = () => pressSort(session, frame, `${MONITORS} th .Prometheus-sort`, "Name");
      const own = await names();

      await press();
      expect(await sortOf()).toBe("ascending");
      expect(await names()).toEqual(
        [...own].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      );

      await press();
      expect(await sortOf()).toBe("descending");

      await press();
      expect(await sortOf()).toBe("none");
      expect(await names()).toEqual(own);
    }, 60_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
