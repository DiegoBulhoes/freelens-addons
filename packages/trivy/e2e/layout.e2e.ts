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

const PAGES: [id: string, container: string][] = [
  ["trivy-dashboard", ".Trivy-page"],
  ["trivy-workloads", ".Trivy-picker"],
  ["trivy-rbac", ".Trivy-page"],
];

const CLICKABLE_ROWS = [".Trivy-picker__item", ".Trivy-picker__detail button.Trivy-row"];

const DESIGN: [id: string, ready: string][] = [
  ["trivy-dashboard", ".Trivy-card"],
  ["trivy-workloads", ".Trivy-picker__detail .Trivy-table"],
  ["trivy-rbac", ".Trivy-table tbody tr"],
  ["trivy-vulnerabilities", ".TrivyVulnerabilityReports .TableRow"],
];

describe("how the Trivy pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

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

  it("builds the RBAC check drawer from the design standard", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await waitFor(
      "the checks",
      async () =>
        (await session.evaluate<number>(
          "document.querySelectorAll('.Trivy-table tbody tr').length",
          frame,
        )) > 0 || undefined,
    );

    await session.evaluate("document.querySelector('.Trivy-table tbody tr')?.click()", frame);
    await waitFor(
      "the drawer's roles",
      async () =>
        (await session.evaluate<number>(
          "document.querySelectorAll('.TrivyObjectDrawer .Trivy-table tbody tr').length",
          frame,
        )) > 0 || undefined,
    );

    expect(await designViolations(session, frame, "Trivy")).toEqual([]);
  }, 90_000);

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

      // A few pixels are rounding; more means the page scrolls sideways.
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

      // Must be the chosen value: center is a button's browser default.
      expect(alignment, `${row} is aligned ${alignment}`).toMatch(/^(left|start)$/);
    }
  }, 90_000);

  it("takes its text colour from the host's theme rather than its own", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");

    const headline = await waitFor("the headline", async () => {
      const colour = await computedStyle(session, frame, ".Trivy-page__headline", "color");

      return colour.length > 0 ? colour : undefined;
    });

    // Fails when a colour is hard-coded in the stylesheet.
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

    // The tooltip renders in a portal, only on a real pointer sequence.
    const tooltip = await hoverForTooltip(session, frame, ".TableRow [id^='tooltip_target_']");

    expect(tooltip.length, "hovering a cell revealed no tooltip").toBeGreaterThan(0);
  }, 90_000);
});
