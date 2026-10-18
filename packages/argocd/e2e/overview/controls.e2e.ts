import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  type ErrorLog,
  notificationText,
  openMenu,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { controlsHelpers } from "../support/argocd";
import { ATTENTION_ROWS, showAllAttention } from "../support/attention";

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
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { where, openDashboard } = controlsHelpers(() => ({ session, frame }));

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

    const CHIPS = '[data-section="attention"] .ArgoCD-filter';
    // As dashboard-page.tsx pages the attention list.
    const PAGE_SIZE = 8;

    const pressedChip = () =>
      session.evaluate<string>(
        `[...document.querySelectorAll(${JSON.stringify(CHIPS)})]
           .find((each) => each.getAttribute("aria-pressed") === "true")
           ?.childNodes[0]?.textContent.trim() ?? ""`,
        frame,
      );

    it("starts on All, and each chip lights alone and shows as many rows as it counts", async () => {
      await showAllAttention(session, frame);

      const chips = await session.evaluate<{ label: string; count: number }[]>(
        `[...document.querySelectorAll(${JSON.stringify(CHIPS)})].map((each) => ({
          label: each.childNodes[0]?.textContent.trim() ?? "",
          count: Number(each.querySelector('.ArgoCD-filter__count')?.textContent ?? Number.NaN),
        }))`,
        frame,
      );

      expect(chips.length, "the section renders no filter chips").toBeGreaterThan(1);
      expect(chips[0]?.label).toBe("All");
      expect(await pressedChip()).toBe("All");

      try {
        for (const { label, count } of chips.slice(1)) {
          await session.evaluate(
            `[...document.querySelectorAll(${JSON.stringify(CHIPS)})]
               .find((each) => each.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)})?.click()`,
            frame,
          );
          await waitFor(`${label} to light`, async () =>
            (await pressedChip()) === label ? true : undefined,
          );

          const shown = Math.min(count, PAGE_SIZE);

          await waitFor(`${label} to show ${shown} rows`, async () =>
            (await countOf(session, frame, ATTENTION_ROWS)) === shown ? true : undefined,
          );
          expect(
            await countOf(session, frame, `${CHIPS}[aria-pressed="true"]`),
            "more than one chip lit",
          ).toBe(1);
        }
      } finally {
        // The filter persists across runs; leave it on All.
        await showAllAttention(session, frame);
      }
      expect(await countOf(session, frame, ATTENTION_ROWS)).toBe(
        Math.min(chips[0]?.count ?? 0, PAGE_SIZE),
      );
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
        await openMenu(session, frame);

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

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
