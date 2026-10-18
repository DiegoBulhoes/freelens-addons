import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  clusterItems,
  countOf,
  type ErrorLog,
  openWorkbench,
  pressSort,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, imageUpdaterHelpers, RULES, type Rule, TOOLBAR_ICON } from "../support/argocd";

// Read-only: writing actions are cancelled at their confirmation, or delete is confirmed with a wrong name.

describe("the Image Updater screens", () => {
  let session: Session;
  let frame: number;
  let rules: Rule[];
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    rules = await clusterItems<Rule>(session, frame, RULES);
  }, 180_000);

  afterAll(() => session?.close());

  const {
    open,
    fromRowMenu,
    measureAndCancelDialog,
    openFromRow,
    closeDrawer,
    expectTitleBar,
    updatedRule,
  } = imageUpdaterHelpers(() => ({ session, frame, rules }));

  describe("the images", () => {
    beforeAll(
      () => open("image-updater-images", "[data-section='image-updater-images'] tbody tr"),
      60_000,
    );

    it("opens the edit form with the image's own settings", async () => {
      await fromRowMenu("image-updater-images", "Edit");

      await waitFor("the edit form", async () =>
        (await countOf(session, frame, '.ConfirmDialog input[aria-label="Version constraint"]')) > 0
          ? true
          : undefined,
      );

      expect(
        await countOf(session, frame, '.ConfirmDialog .ArgoCD-filter[aria-pressed="true"]'),
      ).toBe(1);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);

    it("counts its rows in the head, and narrows them by search", async () => {
      const all = await countOf(session, frame, '[data-section="image-updater-images"] tbody tr');
      const count = await session.evaluate<string>(
        "document.querySelector('.ArgoCD-page__count')?.textContent ?? ''",
        frame,
      );

      expect(count).toBe(`${all} item${all === 1 ? "" : "s"}`);

      await typeInto(
        session,
        frame,
        ".ArgoCD-page__actions .ArgoCD-search",
        "no-image-is-called-this",
      );
      await waitFor("the search to narrow the list", async () =>
        (await countOf(session, frame, '[data-section="image-updater-images"] tbody tr')) === 0
          ? true
          : undefined,
      );
      expect(
        await session.evaluate<string>(
          "document.querySelector('.ArgoCD-page__count')?.textContent ?? ''",
          frame,
        ),
      ).toBe(`0 of ${all} item${all === 1 ? "" : "s"}`);

      await typeInto(session, frame, ".ArgoCD-page__actions .ArgoCD-search", "");
      await waitFor("the list to come back", async () =>
        (await countOf(session, frame, '[data-section="image-updater-images"] tbody tr')) === all
          ? true
          : undefined,
      );
    }, 60_000);

    it("sorts by a header, and says so on it", async () => {
      const sortBy = (column: string) =>
        pressSort(session, frame, '[data-section="image-updater-images"] th .ArgoCD-sort', column);
      const sortState = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('[data-section="image-updater-images"] th')].find((each) => each.textContent.trim() === "Rule")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );

      expect(await sortState()).toBe("none");
      await sortBy("Rule");
      expect(await sortState()).toBe("ascending");
      await sortBy("Rule");
      expect(await sortState()).toBe("descending");
      await sortBy("Rule");
      expect(await sortState()).toBe("none");
    }, 60_000);

    it("opens the image from its row: how a tag is picked, where it is written, what it reaches", async () => {
      const text = await openFromRow("image-updater-images", "image-updater-image", updatedRule());

      expect(text).toMatch(/Image: /);
      for (const fact of [
        "Repository",
        "Strategy",
        "Constraint",
        "Allowed tags",
        "Writes to",
        "Settings in",
        "Rule",
      ]) {
        expect(text).toContain(fact);
      }
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="image-updater-image-applications"] .ArgoCD-row`,
        ),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("puts Edit in the image's title bar, and asks before saving", async () => {
      await expectTitleBar([["edit", /constraint, the strategy and the allowed tags/]]);

      await session.evaluate(`${TOOLBAR_ICON("edit")}.click()`, frame);
      await waitFor("the edit form", async () =>
        (await countOf(session, frame, '.ConfirmDialog input[aria-label="Version constraint"]')) > 0
          ? true
          : undefined,
      );
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      await measureAndCancelDialog();
    }, 60_000);

    it("opens the image's rule from its link", async () => {
      await clickWhenShown(
        session,
        frame,
        `${DRAWER} [data-section="image-updater-image"] .ArgoCD-facts button.ArgoCD-link`,
        updatedRule(),
      );
      await waitFor("the rule's drawer", async () =>
        (await countOf(session, frame, `${DRAWER} [data-section="image-updater-rule"]`)) > 0
          ? true
          : undefined,
      );
      expect(await countOf(session, frame, `${DRAWER} [data-section="image-updater-image"]`)).toBe(
        0,
      );
      await closeDrawer();
    }, 60_000);

    it("opens the rule, not the image, from the rule cell", async () => {
      await clickWhenShown(
        session,
        frame,
        '[data-section="image-updater-images"] tbody button.ArgoCD-link[title="Opens its rule"]',
        updatedRule(),
      );
      await waitFor("the rule's drawer", async () =>
        (await countOf(session, frame, `${DRAWER} [data-section="image-updater-rule"]`)) > 0
          ? true
          : undefined,
      );
      expect(await countOf(session, frame, `${DRAWER} [data-section="image-updater-image"]`)).toBe(
        0,
      );
      await closeDrawer();
    }, 60_000);

    it("keeps every row one line high, as the host's lists do", async () => {
      const heights = await session.evaluate<number[]>(
        `[...document.querySelectorAll('[data-section="image-updater-images"] tbody tr')].map((row) => Math.round(row.getBoundingClientRect().height))`,
        frame,
      );

      expect(new Set(heights).size, `rows of ${heights.join(", ")}px`).toBe(1);
    });

    it("holds text in its cells, not chips or buttons", async () => {
      expect(
        await countOf(
          session,
          frame,
          '[data-section="image-updater-images"] tbody :is(.ArgoCD-chip, .ArgoCD-button)',
        ),
      ).toBe(0);
    });
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
