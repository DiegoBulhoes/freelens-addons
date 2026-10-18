import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickMenuItem,
  clickWhenShown,
  countOf,
  type ErrorLog,
  leaveNothingBehind,
  pressChip,
  pressSort,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  CHIPS,
  column,
  LIST,
  openCoverage,
  ROWS,
  rowNamed,
  SEARCH,
  WORKLOAD_BODY,
} from "../support/lists";
import { activeChip, useWorkbench } from "../support/opentelemetry";

describe("the controls on the OpenTelemetry pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  useWorkbench((opened) => ({ session, frame, errors } = opened));

  const states = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(`${ROWS} .OpenTelemetry-status`)})].map((each) => each.textContent.trim())`,
      frame,
    );

  const rowTexts = (rows: string) =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(rows)})].map((each) => each.textContent)`,
      frame,
    );

  describe("the Coverage list's chips", () => {
    beforeAll(() => openCoverage(session, frame), 90_000);

    it("starts on All, and every narrower chip lights alone and shows no more", async () => {
      expect(await activeChip(session, frame)).toBe("All");

      const all = await countOf(session, frame, ROWS);
      const chips = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(CHIPS)})].map((each) => each.textContent.trim())`,
        frame,
      );

      expect(chips.length).toBeGreaterThan(1);

      for (const chip of chips.slice(1)) {
        await pressChip(session, frame, CHIPS, chip);

        expect(await activeChip(session, frame)).toBe(chip);
        // Compared with All, not a number: a number would be this cluster's contents.
        expect(
          await countOf(session, frame, ROWS),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
      }

      await pressChip(session, frame, CHIPS, "All");
      expect(await countOf(session, frame, ROWS)).toBe(all);
    }, 120_000);

    it("shows under each state's chip only the rows in that state", async () => {
      // These chips are named after the state they keep.
      for (const chip of ["Restart needed", "Injected", "Opted out"]) {
        await pressChip(session, frame, CHIPS, chip);

        const shown = await states();

        expect(shown.length, `${chip} shows nothing`).toBeGreaterThan(0);
        expect(
          shown.filter((each) => each !== chip),
          chip,
        ).toEqual([]);
      }

      await pressChip(session, frame, CHIPS, "Not injected");

      const notInjected = await states();

      // The seed has Misplaced, No Instrumentation, Ambiguous and Blocked rows.
      expect(notInjected).toEqual(
        expect.arrayContaining(["Misplaced", "No Instrumentation", "Ambiguous", "Blocked"]),
      );
      expect(
        notInjected.filter((each) => ["Injected", "Restart needed", "Opted out"].includes(each)),
      ).toEqual([]);

      await pressChip(session, frame, CHIPS, "All");
    }, 90_000);
  });

  describe("the Coverage list's search and sort", () => {
    beforeAll(() => openCoverage(session, frame), 90_000);

    it("narrows to a name that is on the list", async () => {
      const all = await countOf(session, frame, ROWS);
      const [name = ""] = await column(session, frame, LIST, "Name");

      await typeInto(session, frame, SEARCH, name);

      const shown = await waitFor("the list to narrow", async () => {
        const texts = await rowTexts(ROWS);

        return texts.length > 0 && texts.every((each) => each.includes(name)) ? texts : undefined;
      });

      expect(shown.length).toBeLessThanOrEqual(all);
    }, 60_000);

    it("finds a row by namespace/name, as the Overview's rows name it", async () => {
      await typeInto(session, frame, SEARCH, "otel-apps/misplaced");

      const shown = await waitFor("the list to narrow", async () => {
        const texts = await rowTexts(ROWS);

        return texts.length === 1 ? texts : undefined;
      });

      expect(shown[0]).toContain("misplaced");
      await typeInto(session, frame, SEARCH, "");
    }, 60_000);

    it("says so when nothing matches, and comes back when cleared", async () => {
      await typeInto(session, frame, SEARCH, "no-workload-is-called-this");

      expect(
        await waitFor("the empty note", async () => {
          const text = await textOf(session, frame, `${LIST} .OpenTelemetry-section__note`);

          return text.length > 0 ? text : undefined;
        }),
      ).toMatch(/Nothing matches/);

      await typeInto(session, frame, SEARCH, "");
      expect(
        await waitFor(
          "the list back",
          async () => (await countOf(session, frame, ROWS)) || undefined,
        ),
      ).toBeGreaterThan(0);
    }, 60_000);

    it("sorts by a header, and cycles back to the page's own order", async () => {
      const names = () => column(session, frame, LIST, "Name");
      const sortOf = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('${LIST} th')]
             .find((each) => each.textContent.trim() === "Name")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );
      const press = () => pressSort(session, frame, `${LIST} th .OpenTelemetry-sort`, "Name");
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

  describe("a row's menu", () => {
    afterEach(() => leaveNothingBehind(session, frame, "opentelemetry-overview", "opentelemetry"));

    it("closes once an item is picked, asks, and opens no drawer", async () => {
      await openCoverage(session, frame);
      await session.evaluate(
        `${rowNamed(LIST, "otel-late/late")}.querySelector(".OpenTelemetry-table__actions i.Icon").click()`,
        frame,
      );
      await waitFor("the row's menu", async () =>
        (await countOf(session, frame, ".MenuItem")) > 0 ? true : undefined,
      );
      await clickMenuItem(session, frame, "Restart");

      expect(
        await waitFor("the confirmation", async () => {
          const text = await session.evaluate<string>(
            "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
            frame,
          );

          return text || undefined;
        }),
      ).toMatch(/Restart late\?/);
      expect(
        await waitFor(
          "the menu to close",
          async () => ((await countOf(session, frame, ".MenuItem")) === 0 ? true : undefined),
          // The host's close animation is under a second; longer means it stayed open.
          5_000,
        ),
      ).toBe(true);
      expect(await countOf(session, frame, WORKLOAD_BODY)).toBe(0);

      await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
