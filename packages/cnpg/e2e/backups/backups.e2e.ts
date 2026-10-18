import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  leaveNothingBehind,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { CLUSTERS, type ClusterItem, DRAWER, ICON } from "../support/cnpg";

// Read-only: every write is cancelled at its confirmation, or confirmed with the wrong name.

describe("the CloudNativePG controls", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let clusters: ClusterItem[];

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    clusters = await clusterItems<ClusterItem>(session, frame, CLUSTERS);
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  const openBackup = async (prefix: string, phase: string) => {
    await clickSidebar(session, frame, "cnpg-backups", "cnpg");
    await waitFor("the backups", async () =>
      (await countOf(session, frame, '[data-section="cnpg-backups"] tbody tr')) > 0
        ? true
        : undefined,
    );

    const name = await session.evaluate<string>(
      `(() => {
        const row = [...document.querySelectorAll('[data-section="cnpg-backups"] tbody tr')].find((each) => each.textContent.startsWith(${JSON.stringify(prefix)}) && each.textContent.includes(${JSON.stringify(phase)}));
        row?.querySelector("td:not(.CNPG-table__check)")?.click();
        return row?.textContent.split(" · ")[0].trim() ?? "";
      })()`,
      frame,
    );

    expect(name, `a ${phase} ${prefix}* backup`).not.toBe("");
    await waitFor(`${name}'s drawer`, async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-backup"]`)) > 0
        ? true
        : undefined,
    );

    return name;
  };

  it("backs up a cluster picked from the Backups page, offering only those that can be", async () => {
    await clickSidebar(session, frame, "cnpg-backups", "cnpg");
    await waitFor("the backups", async () =>
      (await countOf(session, frame, '[data-section="cnpg-backups"] tbody tr')) > 0
        ? true
        : undefined,
    );
    await clickWhenShown(session, frame, ".CNPG-page__actions button", "Back up");

    expect(await dialogText(session, frame)).toMatch(/Back up which cluster now\?/);

    // react-select opens on a pointer sequence, and lists its options only while open.
    const offered = await session.evaluate<string[]>(
      `(async () => {
        const control = document.querySelector('.ConfirmDialog [class*="Select__control"]');
        if (!control) return [];
        const id = control.querySelector("input")?.id;
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
          control.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
        for (let attempt = 0; attempt < 25; attempt++) {
          const options = [...document.querySelectorAll('[id*="-' + id + '-option-"]')];
          if (options.length > 0) return options.map((each) => each.textContent.trim());
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return [];
      })()`,
      frame,
    );
    const asleep = clusters.find(
      (each) => each.metadata.annotations?.["cnpg.io/hibernation"] === "on",
    );
    const shown = await session.evaluate<string>(
      `document.querySelector('.ConfirmDialog [class*="Select__single-value"]')?.textContent?.trim() ?? ""`,
      frame,
    );

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((each) => /^[^/]+\/[^/]+$/.test(each))).toBe(true);
    expect(offered).toContain(shown);
    expect(offered.some((each) => each.endsWith(`/${asleep?.metadata.name}`))).toBe(false);

    await session.evaluate(
      `document.querySelector('.ConfirmDialog [class*="Select__control"] input')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      frame,
    );
    // The cluster is a select, so the one pressed choice is where to take it from.
    expect(await countOf(session, frame, '.ConfirmDialog .CNPG-filter[aria-pressed="true"]')).toBe(
      1,
    );
    expect(await dialogText(session, frame)).toMatch(/Take it from/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await cancelDialog(session, frame);
  }, 60_000);

  it("links a scheduled backup to its schedule's own drawer", async () => {
    await openBackup("orders-hourly-", "Completed");

    const schedule = await session.evaluate<string>(
      `(() => {
        const term = [...document.querySelectorAll('${DRAWER} .CNPG-facts dt')].find((each) => each.textContent === "Schedule");
        const link = term?.nextElementSibling?.querySelector(".CNPG-link");
        link?.click();
        return link?.textContent ?? "";
      })()`,
      frame,
    );

    expect(schedule).toBe("orders-hourly");

    const title = await waitFor("the schedule's drawer", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-schedule"]`)) > 0
        ? session.evaluate<string>(
            `document.querySelector(${JSON.stringify(`${DRAWER} .drawer-title`)})?.textContent ?? ""`,
            frame,
          )
        : undefined,
    );

    expect(title).toContain("orders-hourly");
    await session.evaluate(`${ICON("close")}?.click()`, frame);
  }, 60_000);

  it("says why a backup failed, from its own instance's log", async () => {
    await openBackup("billing-nightly-", "Failed");

    const banner = await waitFor("the failure's cause", async () => {
      const text = await session.evaluate<string>(
        `document.querySelector('${DRAWER} .CNPG-banner__body')?.textContent ?? ""`,
        frame,
      );

      return text.includes("Cause:") ? text : undefined;
    });

    expect(banner.slice(banner.indexOf("Cause:") + "Cause:".length).trim().length).toBeGreaterThan(
      0,
    );
    await session.evaluate(`${ICON("close")}?.click()`, frame);
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
