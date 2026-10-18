import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  type ErrorLog,
  hoverForTooltip,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";

// Read-only on purpose: Sync and Refresh are opened as far as their confirmation, then cancelled.

describe("the controls on the ArgoCD pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  describe("the bar under the ticked rows of the Applications list", () => {
    const TICKS = ".ArgoCDApplications .TableRow .TableCell.checkbox";
    const BAR = '[data-section="selection"]';

    beforeAll(async () => {
      await clickSidebar(session, frame, "argocd-applications", "argocd");
      await waitFor(
        "two Applications",
        async () => (await countOf(session, frame, TICKS)) >= 2 || undefined,
      );
    }, 90_000);

    const tick = (index: number) =>
      session.evaluate(
        `document.querySelectorAll(${JSON.stringify(TICKS)})[${index}].click()`,
        frame,
      );

    it("is not there until a row is ticked", async () => {
      expect(await countOf(session, frame, BAR)).toBe(0);
    });

    it("counts the ticked rows, and asks before a sync, with prune off", async () => {
      await tick(0);
      await tick(1);

      const count = await waitFor("the bar", async () => {
        const text = await session.evaluate<string>(
          `document.querySelector(${JSON.stringify(`${BAR} .ArgoCD-selection__count`)})?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(count).toBe("2 selected");
      expect(await textOf(session, frame, `${BAR} .ArgoCD-hint`)).toContain("only Sync does");

      const targets = `${BAR} [id^='tooltip_target_']`;
      const tooltips: string[] = [];

      for (let index = 0; index < (await countOf(session, frame, targets)); index++) {
        // Leave the others first, or the previous hover's tooltip is the one read.
        await session.evaluate(
          `document.querySelectorAll(${JSON.stringify(targets)}).forEach((each, at) => {
            for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) {
              each.dispatchEvent(new MouseEvent(type, { bubbles: true }));
            }
            each.toggleAttribute("data-hovered", at === ${index});
          })`,
          frame,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        tooltips.push(await hoverForTooltip(session, frame, `${BAR} [data-hovered]`));
      }

      expect(tooltips).toEqual([
        expect.stringContaining("Changes nothing in the cluster"),
        expect.stringContaining("cached"),
        expect.stringContaining("offers prune"),
      ]);

      await clickWhenShown(session, frame, `${BAR} button`, "Sync");

      const dialog = await waitFor("the confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text || undefined;
      });

      expect(dialog).toContain("Sync the 2 selected Applications?");
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await countOf(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]')).toBe(
        1,
      );
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      expect(dialog).toContain("Prune");
      const ticks = () =>
        session.evaluate<boolean[]>(
          "[...document.querySelectorAll('.ConfirmDialog input[type=checkbox]')].map((box) => box.checked)",
          frame,
        );

      expect(await ticks(), "prune and force must both start off").toEqual([false, false]);

      await clickWhenShown(session, frame, ".ConfirmDialog .Checkbox", "Force");
      await waitFor("the force warning", async () =>
        (
          await session.evaluate<string>(
            "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
            frame,
          )
        ).includes("without graceful deletion")
          ? true
          : undefined,
      );
      expect(await ticks()).toEqual([false, true]);

      await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);

    it("asks before a refresh too, without a typed word", async () => {
      for (const [button, question] of [
        ["Refresh", "Refresh the 2 selected Applications?"],
        ["Hard refresh", "Hard refresh the 2 selected Applications?"],
      ] as const) {
        // "Refresh" is also in "Hard refresh": pick the button by its whole label.
        await session.evaluate(
          `[...document.querySelectorAll(${JSON.stringify(`${BAR} button`)})].find((each) => each.textContent.trim() === ${JSON.stringify(button)})?.click()`,
          frame,
        );

        const dialog = await waitFor("the confirmation", async () => {
          const text = await session.evaluate<string>(
            "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
            frame,
          );

          return text || undefined;
        });

        expect(dialog).toContain(question);
        expect(dialog).toContain("Nothing in the cluster changes.");
        expect(
          await countOf(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]'),
        ).toBe(0);
        expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

        await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
        await waitFor("the dialog to close", async () =>
          (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
        );
      }
    }, 60_000);

    it("goes away once nothing is ticked", async () => {
      await tick(0);
      await tick(1);
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
