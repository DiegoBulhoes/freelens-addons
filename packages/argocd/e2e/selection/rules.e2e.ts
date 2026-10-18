import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, imageUpdaterHelpers, RULES, type Rule } from "../support/argocd";

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

  const { open } = imageUpdaterHelpers(() => ({ session, frame, rules }));

  describe("ticking rules", () => {
    const SECTION = "image-updater-rules";
    const BAR = '[data-section="selection"]';

    beforeAll(() => open(SECTION, `[data-section='${SECTION}'] tbody tr`), 60_000);

    /** Ticks the first `count` rows by their own checkbox, as a person would. */
    const tick = (count: number) =>
      session.evaluate(
        `[...document.querySelectorAll('[data-section="${SECTION}"] tbody .ArgoCD-table__check input')].slice(0, ${count}).forEach((box) => box.click())`,
        frame,
      );

    it("ticks a rule without opening its drawer, and offers Delete in the bar", async () => {
      expect(await countOf(session, frame, BAR)).toBe(0);

      await tick(2);

      const bar = await waitFor("the selection bar", async () => {
        const text = await session.evaluate<string>(
          `document.querySelector(${JSON.stringify(BAR)})?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(bar).toMatch(/2 selected/);
      expect(
        await session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${BAR} button`)})].map((each) => each.textContent.trim())`,
          frame,
        ),
      ).toEqual(["Delete"]);
      expect(
        await countOf(
          session,
          frame,
          `[data-section="${SECTION}"] tbody .ArgoCD-table__row--selected`,
        ),
      ).toBe(2);
      expect(await countOf(session, frame, `${DRAWER} [data-section="image-updater-rule"]`)).toBe(
        0,
      );
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("deletes no rule when the wrong word is typed", async () => {
      await clickWhenShown(session, frame, `${BAR} button`, "Delete");

      const dialog = await dialogText(session, frame);

      expect(dialog).toMatch(/Delete 2 rules\?/);
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
      await clickWhenShown(session, frame, ".ConfirmDialog button", "Delete 2");

      expect(
        await notificationSaying(session, frame, 'Nothing was changed: "confirm"'),
      ).toBeTruthy();

      const after = await clusterItems<Rule>(session, frame, RULES);

      expect(after.map((rule) => rule.metadata.name).sort()).toEqual(
        rules.map((rule) => rule.metadata.name).sort(),
      );
    }, 60_000);

    it("goes away once nothing is ticked", async () => {
      await tick(2);
      await waitFor("the bar to go", async () =>
        (await countOf(session, frame, BAR)) === 0 ? true : undefined,
      );
    }, 30_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
