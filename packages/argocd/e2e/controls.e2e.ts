import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  hoverForTooltip,
  notificationSaying,
  notificationText,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";
import { showAllAttention } from "./attention";

// Read-only on purpose: Sync and Refresh are opened as far as their confirmation, then cancelled.

const CARDS: [label: string, destination: string][] = [
  ["Applications", "/applications"],
  ["Projects", "/projects"],
  ["Synced", "/applications?status=synced"],
  ["OutOfSync", "/applications?status=outofsync"],
  ["Healthy", "/applications?status=healthy"],
  ["Degraded", "/applications?status=degraded"],
  ["Progressing", "/applications?status=progressing"],
  ["No auto-sync", "/applications?status=manual"],
];

const COPIES: [item: string, says: RegExp][] = [
  ["Copy argocd sync command", /copied/i],
  ["Copy kubectl sync patch", /copied/i],
  ["Copy status summary", /copied/i],
];

describe("the controls on the ArgoCD pages", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const where = () =>
    session.evaluate<string>(
      `location.pathname.replace('/extension/freelens-addons--argocd', '') + location.search`,
      frame,
    );

  const openDashboard = async () => {
    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await waitFor("the overview", async () => (await countOf(".ArgoCD-card")) > 0 || undefined);
  };

  describe("the overview's cards", () => {
    it.each(CARDS)(
      "takes %s to %s",
      async (label, destination) => {
        await openDashboard();

        const pressed = await session.evaluate<boolean>(
          `(() => {
          const card = [...document.querySelectorAll('button.ArgoCD-card')]
            .find((each) => each.querySelector('.ArgoCD-card__label')?.textContent.trim() === ${JSON.stringify(label)});
          if (!card) return false;
          card.click();
          return true;
        })()`,
          frame,
        );

        expect(pressed, `no card labelled ${label}`).toBe(true);

        const landed = await waitFor(`the page behind ${label}`, async () => {
          const path = await where();

          return path.startsWith("/applications") || path.startsWith("/projects")
            ? path
            : undefined;
        });

        expect(landed).toContain(destination);
      },
      90_000,
    );
  });

  describe("the attention section's chips", () => {
    beforeAll(openDashboard, 90_000);

    it("starts on All, and a narrower chip cannot show more", async () => {
      await showAllAttention(session, frame);

      const chips = await session.evaluate<string[]>(
        "[...document.querySelectorAll('.ArgoCD-filter')].map((each) => each.textContent.trim())",
        frame,
      );

      expect(chips.length, "the section renders no filter chips").toBeGreaterThan(0);
      expect(chips[0]).toMatch(/^All/);

      const all = await countOf('[data-section="attention"] .ArgoCD-row');

      for (const chip of chips.slice(1)) {
        await session.evaluate(
          `[...document.querySelectorAll('.ArgoCD-filter')]
             .find((each) => each.textContent.trim() === ${JSON.stringify(chip)})?.click()`,
          frame,
        );
        await new Promise((resolve) => setTimeout(resolve, 900));

        expect(
          await countOf('[data-section="attention"] .ArgoCD-row'),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
        expect(
          await countOf('.ArgoCD-filter[aria-pressed="true"]'),
          "more than one chip is lit at once",
        ).toBe(1);
      }

      // The filter persists across runs; leave it on All.
      await showAllAttention(session, frame);
      expect(await countOf('[data-section="attention"] .ArgoCD-row')).toBe(all);
    }, 120_000);
  });

  describe("the copy buttons", () => {
    beforeAll(openDashboard, 90_000);

    it("copies the names a commit can move, and says how many", async () => {
      const pressed = await session.evaluate<boolean>(
        `(() => {
          const button = [...document.querySelectorAll('button')]
            .find((each) => each.textContent.trim() === "content_copy");
          if (!button) return false;
          button.click();
          return true;
        })()`,
        frame,
      );

      expect(pressed, "the moving-target section has no copy button").toBe(true);

      // Reading the clipboard needs a permission the frame lacks, so check the notification.
      expect(await notificationText(session, frame)).toMatch(/\d+ Application names? copied/i);
    }, 90_000);

    it.each(COPIES)(
      "offers %s from a row's menu",
      async (item, says) => {
        await openDashboard();
        await showAllAttention(session, frame);

        await session.evaluate(
          "document.querySelector('.ArgoCD-row__actions i.Icon')?.click()",
          frame,
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const pressed = await session.evaluate<boolean>(
          `(() => {
          const entry = [...document.querySelectorAll('.MenuItem')]
            .find((each) => each.textContent.includes(${JSON.stringify(item)}));
          if (!entry) return false;
          entry.click();
          return true;
        })()`,
          frame,
        );

        expect(pressed, `the menu has no "${item}"`).toBe(true);
        expect(await notificationText(session, frame)).toMatch(says);
      },
      120_000,
    );
  });

  describe("the bar under the ticked rows of the Applications list", () => {
    const TICKS = ".ArgoCDApplications .TableRow .TableCell.checkbox";
    const BAR = '[data-section="selection"]';

    beforeAll(async () => {
      await clickSidebar(session, frame, "argocd-applications", "argocd");
      await waitFor("two Applications", async () => (await countOf(TICKS)) >= 2 || undefined);
    }, 90_000);

    const tick = (index: number) =>
      session.evaluate(
        `document.querySelectorAll(${JSON.stringify(TICKS)})[${index}].click()`,
        frame,
      );

    it("is not there until a row is ticked", async () => {
      expect(await countOf(BAR)).toBe(0);
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

      for (let index = 0; index < (await countOf(targets)); index++) {
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

      await clickByText(session, frame, `${BAR} button`, "Sync");

      const dialog = await waitFor("the confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text || undefined;
      });

      expect(dialog).toContain("Sync the 2 selected Applications?");
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await countOf('.ConfirmDialog input[aria-label="Confirmation"]')).toBe(1);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      expect(dialog).toContain("Prune");
      const ticks = () =>
        session.evaluate<boolean[]>(
          "[...document.querySelectorAll('.ConfirmDialog input[type=checkbox]')].map((box) => box.checked)",
          frame,
        );

      expect(await ticks(), "prune and force must both start off").toEqual([false, false]);

      await clickByText(session, frame, ".ConfirmDialog .Checkbox", "Force");
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

      await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);

    it("goes away once nothing is ticked", async () => {
      await tick(0);
      await tick(1);
      await waitFor("the bar to go", async () => ((await countOf(BAR)) === 0 ? true : undefined));
    }, 30_000);
  });

  describe("the bar under the ticked rows of the Projects list", () => {
    const TICKS = ".ArgoCDAppProjects .TableRow .TableCell.checkbox";
    const BAR = '[data-section="selection"]';
    const PROJECTS = "/apis/argoproj.io/v1alpha1/appprojects";

    interface Project {
      metadata: { name: string };
      spec: { syncWindows?: { description?: string }[] };
    }

    beforeAll(async () => {
      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor("the projects", async () => (await countOf(TICKS)) >= 1 || undefined);
    }, 90_000);

    const tickAll = async () => {
      const rows = await countOf(TICKS);

      for (let index = 0; index < rows; index++) {
        await session.evaluate(
          `document.querySelectorAll(${JSON.stringify(TICKS)})[${index}].click()`,
          frame,
        );
      }

      return rows;
    };

    const confirmation = () =>
      waitFor("the confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text || undefined;
      });

    const cancel = async () => {
      await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
      );
    };

    it("offers the project actions once projects are ticked", async () => {
      expect(await countOf(BAR)).toBe(0);

      const rows = await tickAll();

      const count = await waitFor("the bar", async () => {
        const text = await session.evaluate<string>(
          `document.querySelector(${JSON.stringify(`${BAR} .ArgoCD-selection__count`)})?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(count).toBe(`${rows} selected`);
      expect(
        await session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${BAR} button`)})].map((each) => each.textContent.trim())`,
          frame,
        ),
      ).toEqual(["Refresh all", "Sync all", "Freeze", "Resume"]);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("asks for confirm before freezing, and skips what is already frozen", async () => {
      const projects = await clusterItems<Project>(session, frame, PROJECTS);
      const frozen = projects.filter((project) =>
        (project.spec.syncWindows ?? []).some(
          (each) => each.description === "Frozen from Freelens",
        ),
      );

      await clickByText(session, frame, `${BAR} button`, "Freeze");

      if (frozen.length === projects.length) {
        expect(await notificationSaying(session, frame, "Nothing to freeze")).toMatch(
          /already frozen/,
        );
        return;
      }

      const dialog = await confirmation();

      expect(dialog).toMatch(/Freeze \d+ projects?\?/);
      expect(dialog).toContain("Type confirm to confirm.");
      if (frozen.length > 0) expect(dialog).toMatch(/Skipped: .*already frozen/);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await cancel();
    }, 60_000);

    it("resumes nothing that is not frozen, and says why", async () => {
      const projects = await clusterItems<Project>(session, frame, PROJECTS);
      const frozen = projects.filter((project) =>
        (project.spec.syncWindows ?? []).some(
          (each) => each.description === "Frozen from Freelens",
        ),
      );

      await clickByText(session, frame, `${BAR} button`, "Resume");

      if (frozen.length === 0) {
        expect(await notificationSaying(session, frame, "Nothing to resume")).toMatch(/not frozen/);
      } else {
        expect(await confirmation()).toMatch(/Resume \d+ projects?\?/);
        await cancel();
      }
    }, 60_000);

    it("offers prune before syncing every Application of the ticked projects", async () => {
      await clickByText(session, frame, `${BAR} button`, "Sync all");

      const dialog = await confirmation();

      expect(dialog).toMatch(/Sync \d+ projects?\?/);
      expect(dialog).toContain("Prune");
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await cancel();
    }, 60_000);

    it("goes away once nothing is ticked", async () => {
      await tickAll();
      await waitFor("the bar to go", async () => ((await countOf(BAR)) === 0 ? true : undefined));
    }, 30_000);
  });
  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  const typedFields = () => countOf('.ConfirmDialog input[aria-label="Confirmation"]');

  /** Menu labels ending in an ellipsis; there should be none. */
  const ellipses = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll('.MenuItem .title')]
         .map((each) => each.textContent.trim())
         .filter((label) => /(\\.\\.\\.|…)$/.test(label))`,
      frame,
    );

  describe("the confirmations that ask for a typed word", () => {
    it("asks for an Application's name only once prune or force is ticked", async () => {
      await openDashboard();
      await showAllAttention(session, frame);

      const name = await textOf(session, frame, '[data-section="attention"] .ArgoCD-row__name b');

      await session.evaluate(
        "document.querySelector('[data-section=\"attention\"] .ArgoCD-row__actions i.Icon')?.click()",
        frame,
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(await ellipses()).toEqual([]);
      await clickByText(session, frame, ".MenuItem", "Sync");

      expect(await dialogText()).toContain(`Sync ${name}`);
      expect(await typedFields(), "a plain sync asks for no name").toBe(0);

      await clickByText(session, frame, ".ConfirmDialog .Checkbox", "Prune");
      await waitFor("the name field", async () => ((await typedFields()) === 1 ? true : undefined));
      expect(await dialogText()).toContain(`Type ${name} to confirm.`);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await clickByText(session, frame, ".ConfirmDialog .Checkbox", "Prune");
      await waitFor("the name field to go", async () =>
        (await typedFields()) === 0 ? true : undefined,
      );

      await cancelDialog();
    }, 90_000);

    it("asks for the word confirm before the overview syncs what it shows", async () => {
      await openDashboard();
      await showAllAttention(session, frame);

      await clickByText(
        session,
        frame,
        '[data-section="attention"] .ArgoCD-actions button',
        "Sync",
      );

      expect(await dialogText()).toContain("Type confirm to confirm.");
      expect(await typedFields()).toBe(1);

      await cancelDialog();
    }, 90_000);

    it("asks for the word confirm before a project syncs all its Applications", async () => {
      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor(
        "a project",
        async () =>
          (await countOf(".ArgoCDAppProjects .TableRow .TableCell.menu i.Icon")) > 0 || undefined,
      );

      await session.evaluate(
        "document.querySelector('.ArgoCDAppProjects .TableRow .TableCell.menu i.Icon').click()",
        frame,
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(await ellipses()).toEqual([]);
      await clickByText(session, frame, ".MenuItem", "Sync all");

      const dialog = await dialogText();

      expect(dialog).toMatch(/Sync all \d+ Applications? in/);
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await cancelDialog();
    }, 90_000);
  });
});
