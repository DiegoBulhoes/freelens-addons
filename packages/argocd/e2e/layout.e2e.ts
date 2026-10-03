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
import { showAllAttention } from "./attention";

const PAGES: [id: string, container: string][] = [
  ["argocd-dashboard", ".ArgoCD-page"],
  ["argocd-applications", ".ArgoCDApplications"],
  ["argocd-projects", ".ArgoCDAppProjects"],
  ["image-updater-overview", ".ArgoCD-page"],
  ["image-updater-rules", ".ArgoCD-page"],
  ["image-updater-images", ".ArgoCD-page"],
  ["image-updater-updates", ".ArgoCD-page"],
];

/** A selector each page renders only once its data has arrived. */
const DESIGN: [id: string, ready: string][] = [
  ["argocd-dashboard", ".ArgoCD-card"],
  ["argocd-applications", ".ArgoCD-badge"],
  ["argocd-projects", ".ArgoCDAppProjects .TableRow"],
  ["image-updater-overview", ".ArgoCD-card"],
  ["image-updater-rules", "[data-section='image-updater-rules'] .ArgoCD-table"],
  ["image-updater-images", "[data-section='image-updater-images'] .ArgoCD-table"],
  ["image-updater-updates", "[data-section='image-updater-updates'] .ArgoCD-table"],
];

/** Image Updater's screens sit one sidebar level deeper. */
const groupsOf = (id: string) =>
  id.startsWith("image-updater-") ? ["argocd", "argocd-image-updater"] : "argocd";

describe("how the ArgoCD pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  it.each(DESIGN)(
    "builds %s from the design standard",
    async (id, ready) => {
      await clickSidebar(session, frame, id, groupsOf(id));
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    },
    90_000,
  );

  it.each(PAGES)(
    "keeps %s within its width",
    async (id, container) => {
      await clickSidebar(session, frame, id, groupsOf(id));

      const overflow = await waitFor(`${id} to lay out`, async () => {
        try {
          return await overflowsSideways(session, frame, container);
        } catch {
          return undefined;
        }
      });

      // A few pixels is rounding; more means the page scrolls sideways.
      expect(overflow, `${id} scrolls sideways by ${overflow}px`).toBeLessThan(8);
    },
    90_000,
  );

  it("leaves the text of a clickable row where a reader expects it", async () => {
    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await showAllAttention(session, frame);

    // A <button> defaults to center; the row must set left explicitly.
    const alignment = await computedStyle(session, frame, ".ArgoCD-row__main", "text-align");

    expect(alignment, `a row is aligned ${alignment}`).toMatch(/^(left|start)$/);
  }, 90_000);

  it("takes its text colour from the host's theme rather than its own", async () => {
    await clickSidebar(session, frame, "argocd-dashboard", "argocd");

    const headline = await waitFor("the headline", async () => {
      const colour = await computedStyle(session, frame, ".ArgoCD-page__headline", "color");

      return colour.length > 0 ? colour : undefined;
    });

    expect(headline).toBe(await resolvedThemeColor(session, frame, "--textColorPrimary"));
  }, 90_000);

  it("explains a truncated cell on hover rather than hiding it", async () => {
    await clickSidebar(session, frame, "argocd-applications", "argocd");
    await waitFor(
      "the Applications list",
      async () =>
        (await session.evaluate<number>("document.querySelectorAll('.TableRow').length", frame)) >
          0 || undefined,
    );

    // The tooltip renders into a portal only on a real pointer sequence.
    const tooltip = await hoverForTooltip(session, frame, ".TableRow [id^='tooltip_target_']");

    expect(tooltip.length, "hovering a cell revealed no tooltip").toBeGreaterThan(0);
  }, 90_000);
});
