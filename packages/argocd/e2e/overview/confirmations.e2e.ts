import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickMenuItem,
  clickSidebar,
  clickWhenShown,
  countOf,
  dialogText,
  type ErrorLog,
  openMenu,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { controlsHelpers } from "../support/argocd";
import { ATTENTION_ROWS, showAllAttention } from "../support/attention";

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

  const { openDashboard, measureAndCancelDialog, typedFields, ellipses } = controlsHelpers(() => ({
    session,
    frame,
  }));

  describe("the confirmations that ask for a typed word", () => {
    // Seeded OutOfSync with no automated sync, so it never has an operation hiding Sync.
    const NAME = "helm-guestbook";
    const SEARCH = '[data-section="attention"] .ArgoCD-search';

    const pressKebab = () =>
      session.evaluate<boolean>(
        `(() => {
          const row = [...document.querySelectorAll(${JSON.stringify(ATTENTION_ROWS)})]
            .find((each) => each.querySelector('.ArgoCD-row__name b')?.textContent.trim() === ${JSON.stringify(NAME)});
          const kebab = row?.querySelector('.ArgoCD-row__actions i.Icon');
          kebab?.click();
          return Boolean(kebab);
        })()`,
        frame,
      );

    it("asks for an Application's name only once prune or force is ticked", async () => {
      await openDashboard();
      await showAllAttention(session, frame);

      await typeInto(session, frame, SEARCH, NAME);

      try {
        await waitFor(`${NAME} on the attention list`, async () =>
          (await pressKebab()) ? true : undefined,
        );
        await openMenu(session, frame);
        expect(await ellipses()).toEqual([]);
        await clickMenuItem(session, frame, "Sync");

        expect(await dialogText(session, frame)).toContain(`Sync ${NAME}`);
        expect(await typedFields(), "a plain sync asks for no name").toBe(0);

        await clickWhenShown(session, frame, ".ConfirmDialog .Checkbox", "Prune");
        await waitFor("the name field", async () =>
          (await typedFields()) === 1 ? true : undefined,
        );
        expect(await dialogText(session, frame)).toContain(`Type ${NAME} to confirm.`);
        expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

        await clickWhenShown(session, frame, ".ConfirmDialog .Checkbox", "Prune");
        await waitFor("the name field to go", async () =>
          (await typedFields()) === 0 ? true : undefined,
        );

        await measureAndCancelDialog();
      } finally {
        await typeInto(session, frame, SEARCH, "");
      }
    }, 90_000);

    it("asks for the word confirm before the overview syncs what it shows", async () => {
      await openDashboard();
      await showAllAttention(session, frame);

      await clickWhenShown(
        session,
        frame,
        '[data-section="attention"] .ArgoCD-actions button',
        "Sync",
      );

      expect(await dialogText(session, frame)).toContain("Type confirm to confirm.");
      expect(await typedFields()).toBe(1);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await measureAndCancelDialog();
    }, 90_000);

    it("asks for the word confirm before a project syncs all its Applications", async () => {
      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor(
        "a project",
        async () =>
          (await countOf(session, frame, ".ArgoCDAppProjects .TableRow .TableCell.menu i.Icon")) >
            0 || undefined,
      );

      await session.evaluate(
        "document.querySelector('.ArgoCDAppProjects .TableRow .TableCell.menu i.Icon').click()",
        frame,
      );
      await openMenu(session, frame);
      expect(await ellipses()).toEqual([]);
      await clickMenuItem(session, frame, "Sync all");

      const dialog = await dialogText(session, frame);

      expect(dialog).toMatch(/Sync all \d+ Applications? in/);
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await measureAndCancelDialog();
    }, 90_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
