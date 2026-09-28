import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations } from "../../../build/e2e/design";
import {
  clickSidebar,
  computedStyle,
  hoverForTooltip,
  openWorkbench,
  overflowsSideways,
  resolvedThemeColor,
  waitFor,
} from "../../../build/e2e/freelens";
import { openScannedWorkload } from "./picker";

/**
 * How the pages are laid out, which nothing else here looks at.
 *
 * Every other file reads text and counts elements, and all of that passes on a
 * page whose table runs off the side, whose clickable names are centred, or whose
 * colours are painted in rather than taken from the host. Those are the
 * regressions a person notices immediately and a suite never does.
 *
 * Each of these guards something that has actually gone wrong here:
 *
 *   - A row built as a `<button>` inherits `text-align: center` from the browser,
 *     so a list of names came out centred and looked like a mistake.
 *   - A wide findings table pushed the page sideways, leaving the operator
 *     scrolling to read a severity.
 *   - Colours come from the host's theme variables, so the pages follow a theme
 *     change. A value written in only shows up when someone switches theme.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

/** Every page of this extension, and the element that should contain its width. */
const PAGES: [id: string, container: string][] = [
  ["trivy-dashboard", ".Trivy-page"],
  ["trivy-workloads", ".Trivy-picker"],
  ["trivy-rbac", ".Trivy-page"],
];

/** Clickable rows, which is where the centred-text default bites. */
const CLICKABLE_ROWS = [".Trivy-picker__item", ".Trivy-picker__detail button.Trivy-row"];

/** Every page, and something each renders only once its data has arrived. */
const DESIGN: [id: string, ready: string][] = [
  ["trivy-dashboard", ".Trivy-card"],
  // Opened on a scanned workload, so the detail has its tables to check.
  ["trivy-workloads", ".Trivy-picker__detail .Trivy-table"],
  ["trivy-rbac", ".Trivy-box"],
  ["trivy-vulnerabilities", ".TrivyVulnerabilityReports .TableRow"],
];

describe("how the Trivy pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  // The standard's promises, read off every page once it has something on it:
  // the surface grey, left-aligned buttons, the pressed filter's accent, and no
  // class of ours that no stylesheet defines. See build/e2e/design.ts.
  it.each(DESIGN)(
    "builds %s from the design standard",
    async (id, ready) => {
      if (id === "trivy-workloads") await openScannedWorkload(session, frame);
      else await clickSidebar(session, frame, id, "trivy");
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      expect(await designViolations(session, frame, "Trivy")).toEqual([]);
    },
    90_000,
  );

  it.each(PAGES)(
    "keeps %s within its width",
    async (id, container) => {
      await clickSidebar(session, frame, id, "trivy");

      const overflow = await waitFor(`${id} to lay out`, async () => {
        try {
          return await overflowsSideways(session, frame, container);
        } catch {
          return undefined;
        }
      });

      // A pixel or two is rounding; a scrollbar's worth is a layout that does not
      // fit. Anything that has to scroll sideways should scroll inside its own
      // panel, not take the page with it.
      expect(overflow, `${id} scrolls sideways by ${overflow}px`).toBeLessThan(8);
    },
    90_000,
  );

  it("leaves the text of a clickable row where a reader expects it", async () => {
    await clickSidebar(session, frame, "trivy-workloads", "trivy");
    await waitFor(
      "the picker",
      async () =>
        (await session.evaluate<number>(
          "document.querySelectorAll('.Trivy-picker__item').length",
          frame,
        )) > 0 || undefined,
    );

    for (const row of CLICKABLE_ROWS) {
      const alignment = await computedStyle(session, frame, row, "text-align");

      // Not "not center": the value has to be the one that was chosen, because
      // the browser's default for a button is center and inheriting it is the bug.
      expect(alignment, `${row} is aligned ${alignment}`).toMatch(/^(left|start)$/);
    }
  }, 90_000);

  it("takes its text colour from the host's theme rather than its own", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");

    const headline = await waitFor("the headline", async () => {
      const colour = await computedStyle(session, frame, ".Trivy-page__headline", "color");

      return colour.length > 0 ? colour : undefined;
    });

    // If this ever fails it is because a colour was written into the stylesheet:
    // the page will look right in the theme it was written for and wrong in the
    // other one, which is the half nobody checks.
    expect(headline).toBe(await resolvedThemeColor(session, frame, "--textColorPrimary"));
  }, 90_000);

  it("explains a truncated cell on hover rather than hiding it", async () => {
    await clickSidebar(session, frame, "trivy-vulnerabilities", "trivy");
    await waitFor(
      "the report list",
      async () =>
        (await session.evaluate<number>("document.querySelectorAll('.TableRow').length", frame)) >
          0 || undefined,
    );

    // The columns wrap their contents in the host's tooltip component so a name
    // too long for its column is still readable. The tooltip renders into a
    // portal and only on a pointer sequence, so nothing short of a real hover
    // shows whether it was wired up.
    const tooltip = await hoverForTooltip(session, frame, ".TableRow [id^='tooltip_target_']");

    expect(tooltip.length, "hovering a cell revealed no tooltip").toBeGreaterThan(0);
  }, 90_000);
});
