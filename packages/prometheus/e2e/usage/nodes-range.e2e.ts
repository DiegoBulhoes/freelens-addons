import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickSidebar,
  clickWhenShown,
  countOf,
  DEV_NODE,
  type ErrorLog,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
  waitForNoDialog,
} from "../../../../build/e2e/freelens";
import {
  chooseInFilter,
  LISTS,
  NODE_CHARTS,
  NODES,
  NOTICE,
  POD_CHART,
  PODS,
  RANGE_LABEL,
  USAGE_GROUP,
  WINDOW,
  windowSays,
} from "../support/lists";
import {
  CORES,
  END,
  RANGE_ERROR,
  resetUsage,
  SHARE,
  START,
  SUBLINE,
  usageReads,
} from "../support/prometheus";

// Figures are the dev cluster's, so only their shape is checked.

describe("the Usage pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    await resetUsage(session, frame);
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { untilCell } = usageReads(() => ({ session, frame }));

  describe("Nodes", () => {
    it("charts a fixed range it does not ask again, refuses an end in the future keeping what was typed, and goes back to a window", async () => {
      await clickSidebar(session, frame, LISTS.nodes.page, USAGE_GROUP);
      await waitFor(
        "the window select",
        async () => (await countOf(session, frame, WINDOW)) || undefined,
      );

      const openRange = async () => {
        await chooseInFilter(session, frame, WINDOW, "Custom range", false);

        return waitFor("the range dialog", async () => {
          const value = await session.evaluate<string>(
            `document.querySelector(${JSON.stringify(START)})?.value ?? ""`,
            frame,
          );

          return value || undefined;
        });
      };

      const inputValue = (selector: string) =>
        session.evaluate<string>(
          `document.querySelector(${JSON.stringify(selector)})?.value ?? ""`,
          frame,
        );

      try {
        const start = await openRange();

        expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(await dialogColourViolations(session, frame, "Prometheus")).toEqual([]);

        const end = await inputValue(END);

        await typeInto(session, frame, END, "2999-01-01T00:00");
        await clickWhenShown(session, frame, ".ConfirmDialog button", "Apply");
        expect(
          await waitFor("the range to come back refused", async () => {
            const text = await textOf(session, frame, RANGE_ERROR);

            return text.includes("The end cannot be in the future.") ? text : undefined;
          }),
        ).toMatch(/future/);
        expect([await inputValue(START), await inputValue(END)]).toEqual([
          start,
          "2999-01-01T00:00",
        ]);
        expect(await dialogColourViolations(session, frame, "Prometheus")).toEqual([]);
        expect(await windowSays(session, frame)).toBe("1 hour");

        await typeInto(session, frame, END, end);
        await clickWhenShown(session, frame, ".ConfirmDialog button", "Apply");
        await waitForNoDialog(session, frame, "the range dialog to close");
        expect(await windowSays(session, frame)).toBe("Custom range");
        expect(await textOf(session, frame, RANGE_LABEL)).toMatch(/ to /);
        expect(await textOf(session, frame, SUBLINE)).toMatch(/ to .*not asked again/);
        expect(await untilCell(NODES, DEV_NODE, "CPU", SHARE)).toMatch(CORES);
        expect(await designViolations(session, frame, "Prometheus")).toEqual([]);

        await chooseInFilter(session, frame, WINDOW, "1 hour");
        expect(await windowSays(session, frame)).toBe("1 hour");
        expect(await countOf(session, frame, RANGE_LABEL)).toBe(0);
      } finally {
        if (await countOf(session, frame, ".ConfirmDialog")) {
          await cancelDialog(session, frame).catch(() => undefined);
        }
        if ((await windowSays(session, frame)) !== "1 hour") {
          await chooseInFilter(session, frame, WINDOW, "1 hour").catch(() => undefined);
        }
      }
    }, 180_000);

    // Before the dev cluster existed, so Prometheus answers with no series at all.
    it("says No data and No series in a range with no series, and no notice that Prometheus is missing", async () => {
      await clickSidebar(session, frame, LISTS.nodes.page, USAGE_GROUP);
      await waitFor(
        "the window select",
        async () => (await countOf(session, frame, WINDOW)) || undefined,
      );

      const emptyCharts = (section: string) =>
        session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${section} .Prometheus-chart__empty`)})].map((each) => each.textContent.trim())`,
          frame,
        );

      try {
        await chooseInFilter(session, frame, WINDOW, "Custom range", false);
        await waitFor(
          "the range dialog",
          async () => (await countOf(session, frame, START)) || undefined,
        );
        await typeInto(session, frame, START, "2001-01-01T00:00");
        await typeInto(session, frame, END, "2001-01-01T01:00");
        await clickWhenShown(session, frame, ".ConfirmDialog button", "Apply");
        await waitForNoDialog(session, frame, "the range dialog to close");
        expect(await windowSays(session, frame)).toBe("Custom range");

        expect(
          await waitFor(
            "the four charts to say why they are empty",
            async () => {
              const notes = await emptyCharts(NODE_CHARTS);

              return notes.length === 4 && notes.every((each) => each !== "Asking Prometheus.")
                ? notes
                : undefined;
            },
            120_000,
          ),
        ).toEqual(Array(4).fill("No series in this window."));
        expect(await untilCell(NODES, DEV_NODE, "State", /^No data/)).toMatch(
          /^No data · No node-exporter series/,
        );
        expect(await countOf(session, frame, NOTICE)).toBe(0);
        expect(await designViolations(session, frame, "Prometheus")).toEqual([]);

        await clickSidebar(session, frame, LISTS.pods.page, USAGE_GROUP);
        expect(await windowSays(session, frame)).toBe("Custom range");
        expect(
          await waitFor(
            "the pod chart to say why it is empty",
            async () => {
              const [note] = await emptyCharts(POD_CHART);

              return note && note !== "Asking Prometheus." ? note : undefined;
            },
            120_000,
          ),
        ).toBe("No series in this window.");
        expect(await untilCell(PODS, "monitoring/prometheus-seed-0", "State", /^No data/)).toMatch(
          /^No data · No cAdvisor series/,
        );
        expect(await countOf(session, frame, NOTICE)).toBe(0);
      } finally {
        if (await countOf(session, frame, ".ConfirmDialog")) {
          await cancelDialog(session, frame).catch(() => undefined);
        }
        if ((await windowSays(session, frame)) !== "1 hour") {
          await chooseInFilter(session, frame, WINDOW, "1 hour").catch(() => undefined);
        }
      }
      expect(await windowSays(session, frame)).toBe("1 hour");
    }, 300_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
