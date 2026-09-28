import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  notificationText,
  openWorkbench,
  waitFor,
} from "../../../build/e2e/freelens";
import { showAllAttention } from "./attention";

/**
 * Every control this extension renders, clicked — except the ones that change
 * the cluster.
 *
 * A card that looks pressable and goes nowhere, a chip that highlights and
 * filters nothing, a copy button that copies an empty string: all three render
 * perfectly and all three are useless.
 *
 * Deliberately not here:
 *
 *   - `Sync...`, `Refresh` and `Hard Refresh`, from the row menu, and
 *     `Refresh N` / `Sync N` from the section bar. Those patch Applications in
 *     the cluster. The development cluster is disposable and could carry it, but
 *     it was decided that this suite stays read-only; `patches.ts` covers what
 *     they send.
 *   - `Logs`, which opens the host's own log dialog for a pod of the Application.
 *     What it opens is Freelens' UI, not this extension's.
 *   - `Pin to the top`, which has a flow of its own in `flow-pin.e2e.ts`,
 *     followed as far as the file it writes.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

/** Each card, by the label under its number, and where pressing it should land. */
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

/** The menu items that only read, and what each promises afterwards. */
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

  /** The path of this extension's own pages, with its prefix taken off. */
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

        // A status card is a question — "which ones are degraded?" — so the answer
        // has to arrive narrowed, not as the whole list.
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

      // The filter outlives the run; leave it on All for whatever opens the page next.
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

      // Not the clipboard itself: reading it needs a permission this frame has
      // not been granted. What is checked is the promise made to the operator,
      // and that it names a number rather than saying nothing was there.
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
});
