import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  type ErrorLog,
  leaveNothingBehind,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { cnpgHelpers, DRAWER } from "../support/cnpg";

describe("the CloudNativePG controls", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  const { closeDrawer } = cnpgHelpers(() => ({ session, frame }));

  it("opens the cluster's own drawer from its row of the overview, not a search", async () => {
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");
    await waitFor("attention rows", async () =>
      (await countOf(session, frame, ".CNPG-row")) > 0 ? true : undefined,
    );

    const name = await session.evaluate<string>(
      `(() => {
        const row = [...document.querySelectorAll('.CNPG-row')].find((each) => each.querySelector('.CNPG-row__meta')?.textContent.startsWith("Cluster"));
        row?.click();
        return row?.querySelector('.CNPG-row__name b')?.textContent ?? "";
      })()`,
      frame,
    );

    expect(name).not.toBe("");

    const title = await waitFor("the cluster's drawer", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-cluster"]`)) > 0
        ? session.evaluate<string>(
            `document.querySelector(${JSON.stringify(`${DRAWER} .drawer-title`)})?.textContent ?? ""`,
            frame,
          )
        : undefined,
    );

    expect(title).toContain(`Cluster: ${name}`);
    expect(
      await session.evaluate<string>("document.querySelector('.CNPG-search')?.value ?? ''", frame),
    ).toBe("");
    await closeDrawer();
  }, 60_000);

  it("opens a card's list on the rows the card counts", async () => {
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");

    const card = await waitFor("the No backup card", async () => {
      const value = await session.evaluate<string>(
        `[...document.querySelectorAll('[data-section="cnpg-cards"] .CNPG-card')].find((each) => each.querySelector('.CNPG-card__label')?.textContent === "No backup")?.querySelector('.CNPG-card__value')?.textContent ?? ""`,
        frame,
      );

      return value || undefined;
    });

    await clickWhenShown(session, frame, '[data-section="cnpg-cards"] .CNPG-card', "No backup");

    const pressed = await waitFor("the No backup chip, once the list has loaded", async () => {
      const { text, connecting } = await session.evaluate<{ text: string; connecting: boolean }>(
        `({
          text: document.querySelector('[data-section="cnpg-cluster-filters"] [aria-pressed="true"]')?.textContent ?? "",
          connecting: (document.querySelector('.CNPG-page__subline')?.textContent ?? "").startsWith("Connecting"),
        })`,
        frame,
      );

      // Each list loads again on mount, counting nothing until it has.
      return !connecting && text.startsWith("No backup") ? text : undefined;
    });

    expect(pressed).toBe(`No backup${card}`);
    expect(await countOf(session, frame, '[data-section="cnpg-clusters"] tbody tr')).toBe(
      Number(card),
    );
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
