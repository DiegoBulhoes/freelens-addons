import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  type ErrorLog,
  openWorkbench,
  pressChip,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { activeChip, chipCount } from "../support/trivy";
import { BODY, CHIPS, closeDrawer, drawerTitle, EMPTY, ROW } from "../support/workloads";

describe("the controls on the Trivy pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  describe("the overview's most exposed workloads", () => {
    it("lists them by critical findings, and opens each on its drawer", async () => {
      await clickSidebar(session, frame, "trivy-dashboard", "trivy");
      await waitFor(
        "the list",
        async () => (await countOf(session, frame, ".Trivy-row")) > 0 || undefined,
      );

      // Counts only: coverage rows are critical too, and their state is words.
      const criticals = await session.evaluate<number[]>(
        `[...document.querySelectorAll('.Trivy-row__state')]
           .map((each) => each.textContent.trim())
           .filter((text) => /^\\d+ critical$/.test(text))
           .map((text) => Number.parseInt(text, 10))`,
        frame,
      );

      expect(criticals.length).toBeGreaterThan(0);

      expect([...criticals].sort((first, second) => second - first)).toEqual(criticals);

      const name = await session.evaluate<string>(
        `(() => {
          const row = [...document.querySelectorAll('.Trivy-row')]
            .find((each) => /critical$/.test(each.querySelector('.Trivy-row__state')?.textContent ?? ''));
          row?.click();
          return row?.querySelector('.Trivy-row__name b')?.textContent.trim() ?? '';
        })()`,
        frame,
      );

      expect(name).not.toBe("");

      expect(
        await waitFor("that workload's drawer", async () =>
          (await drawerTitle(session, frame)).endsWith(`: ${name}`) ? true : undefined,
        ),
      ).toBe(true);
      // The list is the page under it, not a page of its own.
      expect(await countOf(session, frame, ROW)).toBeGreaterThan(0);

      await closeDrawer(session, frame);
    }, 90_000);
  });

  describe("the overview's cards", () => {
    const openFromCard = async (label: string) => {
      await clickSidebar(session, frame, "trivy-dashboard", "trivy");
      await waitFor(
        "the cards",
        async () => (await countOf(session, frame, "button.Trivy-card")) > 0 || undefined,
      );
      await clickWhenShown(session, frame, "button.Trivy-card", label);
      await waitFor(
        "the workload list",
        async () => (await countOf(session, frame, ROW)) > 0 || undefined,
      );
    };

    it("opens Workloads on every workload from the count of them", async () => {
      await openFromCard("Workloads known");

      expect(await activeChip(session, frame, CHIPS)).toBe("All");
      expect(await countOf(session, frame, BODY), "a card opened a drawer").toBe(0);
    }, 90_000);

    it("opens Workloads from each counting card on that card's own filter", async () => {
      const cards = [
        "Critical, fix published",
        "Critical, no fix yet",
        "High, fix published",
        "Config issues, critical or high",
      ];

      for (const label of cards) {
        await openFromCard(label);

        try {
          expect(await activeChip(session, frame, CHIPS), `${label} opened another filter`).toBe(
            label,
          );
        } finally {
          // The page may stay mounted with its filter set.
          await pressChip(session, frame, `${CHIPS} button`, "All");
        }
      }
    }, 240_000);

    // The seed exposes no secret, so its filter lists nothing and says why.
    it("opens Workloads from the secrets card on its own filter, even when it lists none", async () => {
      const label = "Exposed secrets, critical or high";

      await clickSidebar(session, frame, "trivy-dashboard", "trivy");
      await waitFor(
        "the cards",
        async () => (await countOf(session, frame, "button.Trivy-card")) > 0 || undefined,
      );
      await clickWhenShown(session, frame, "button.Trivy-card", label);

      try {
        await waitFor("its filter", async () =>
          (await activeChip(session, frame, CHIPS)) === label ? true : undefined,
        );
        expect(await chipCount(session, frame, CHIPS, label)).toBe(
          await countOf(session, frame, ROW),
        );
        if ((await countOf(session, frame, ROW)) === 0) {
          expect(await textOf(session, frame, EMPTY)).toBe(
            "No workload here exposes a critical or high secret.",
          );
        }
      } finally {
        await pressChip(session, frame, `${CHIPS} button`, "All");
      }
    }, 90_000);
  });

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
