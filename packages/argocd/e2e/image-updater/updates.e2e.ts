import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  clusterItems,
  countOf,
  type ErrorLog,
  openWorkbench,
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

  const { open, fromRowMenu, measureAndCancelDialog, openFromRow, closeDrawer, expectTitleBar } =
    imageUpdaterHelpers(() => ({ session, frame, rules }));

  describe("the updates", () => {
    beforeAll(
      () => open("image-updater-updates", "[data-section='image-updater-updates'] tbody tr"),
      60_000,
    );

    it("shows a row for each rule that has updated", async () => {
      const updated = rules.filter((rule) => rule.status?.lastUpdatedAt).length;

      expect(
        await countOf(session, frame, '[data-section="image-updater-updates"] tbody tr'),
      ).toBeGreaterThanOrEqual(updated);
    });

    it("opens the update from its row: from and to, when, its Applications and its rule", async () => {
      const text = await openFromRow("image-updater-updates", "image-updater-update");

      expect(text).toMatch(/Image update: .+ → /);
      for (const fact of ["From", "To", "When", "Applications updated", "Rule"]) {
        expect(text).toContain(fact);
      }
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="image-updater-update-applications"] .ArgoCD-row`,
        ),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("puts Undo in the update's title bar, and asks first", async () => {
      await expectTitleBar([["undo", /previous tag back/]]);

      await session.evaluate(`${TOOLBAR_ICON("undo")}.click()`, frame);

      const dialog = await waitFor("the Undo confirmation or its refusal", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent || document.querySelector('.Notifications')?.textContent || ''",
          frame,
        );

        return text || undefined;
      });

      if ((await countOf(session, frame, ".ConfirmDialog")) > 0) {
        expect(dialog).toMatch(/Pin to/);
        expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
        await measureAndCancelDialog();
      } else {
        expect(dialog).toMatch(/Cannot undo from here/);
      }
    }, 60_000);

    it("opens the update's rule from its link", async () => {
      await session.evaluate(
        `document.querySelector(${JSON.stringify(`${DRAWER} [data-section="image-updater-update"] .ArgoCD-facts button.ArgoCD-link`)}).click()`,
        frame,
      );
      await waitFor("the rule's drawer", async () =>
        (await countOf(session, frame, `${DRAWER} [data-section="image-updater-rule"]`)) > 0
          ? true
          : undefined,
      );
      await closeDrawer();
    }, 60_000);

    it("opens the rule, not the update, from the rule cell", async () => {
      await session.evaluate(
        `document.querySelector('[data-section="image-updater-updates"] tbody button.ArgoCD-link[title="Opens its rule"]').click()`,
        frame,
      );
      await waitFor("the rule's drawer", async () =>
        (await countOf(session, frame, `${DRAWER} [data-section="image-updater-rule"]`)) > 0
          ? true
          : undefined,
      );
      expect(await countOf(session, frame, `${DRAWER} [data-section="image-updater-update"]`)).toBe(
        0,
      );
      await closeDrawer();
    }, 60_000);

    it("asks before undoing from the row's menu too", async () => {
      await fromRowMenu("image-updater-updates", "Undo");

      const dialog = await waitFor("the Undo confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text || undefined;
      });

      expect(dialog).toMatch(/Pin to/);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);

    it("keeps every row one line high, as the host's lists do", async () => {
      const heights = await session.evaluate<number[]>(
        `[...document.querySelectorAll('[data-section="image-updater-updates"] tbody tr')].map((row) => Math.round(row.getBoundingClientRect().height))`,
        frame,
      );

      expect(new Set(heights).size, `rows of ${heights.join(", ")}px`).toBe(1);
    });
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
