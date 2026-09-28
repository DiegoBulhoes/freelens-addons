import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations } from "../../../build/e2e/design";
import {
  clickSidebar,
  computedStyle,
  openWorkbench,
  overflowsSideways,
  resolvedThemeColor,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * How the pages are laid out, which nothing else here looks at.
 *
 * Every row that can be clicked is a `<button>`, and a button's default is
 * `text-align: center`; a colour written into the stylesheet looks right in one
 * theme only; a Challenge's reason is a long line with a URL in it and pushes a
 * page sideways unless something lets it wrap. And the validity bar is the one
 * piece of drawn UI: its "now" marker has to sit on its track.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

const PAGES: [id: string, container: string][] = [
  ["cert-manager-overview", ".CertManager-page"],
  ["cert-manager-certificates", ".CertManager-picker"],
  ["cert-manager-issuers", ".CertManager-page"],
  ["cert-manager-unmanaged", ".CertManager-page"],
];

/** Every page, and something each renders only once its data has arrived. */
const DESIGN: [id: string, ready: string][] = [
  ["cert-manager-overview", ".CertManager-row"],
  ["cert-manager-certificates", ".CertManager-picker__detail .CertManager-row"],
  ["cert-manager-issuers", ".CertManager-box"],
  ["cert-manager-requests", ".CertManagerRequests .TableRow"],
  ["cert-manager-unmanaged", ".CertManager-box"],
];

describe("how the cert-manager pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  // The standard's promises, read off every page once it has something on it:
  // the surface grey, left-aligned buttons, the pressed filter's accent, and no
  // class of ours that no stylesheet defines. See build/e2e/design.ts.
  it.each(DESIGN)(
    "builds %s from the design standard",
    async (id, ready) => {
      await clickSidebar(session, frame, id, "cert-manager");
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      expect(await designViolations(session, frame, "CertManager")).toEqual([]);
    },
    90_000,
  );

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  it.each(PAGES)(
    "keeps %s within its width",
    async (id, container) => {
      await clickSidebar(session, frame, id, "cert-manager");

      const overflow = await waitFor(`${id} to lay out`, async () => {
        try {
          return await overflowsSideways(session, frame, container);
        } catch {
          return undefined;
        }
      });

      expect(overflow, `${id} scrolls sideways by ${overflow}px`).toBeLessThan(8);
    },
    90_000,
  );

  it("keeps a certificate's detail within its width, the long ACME reason included", async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the picker",
      async () => (await countOf(".CertManager-picker__item")) > 0 || undefined,
    );

    // The first row is the most urgent: on the seeded cluster, the ACME one with
    // the longest reason. Whatever it is, the detail pane must not scroll sideways.
    await session.evaluate("document.querySelector('.CertManager-picker__item').click()", frame);
    await waitFor(
      "its chain",
      async () => (await countOf(".CertManager-picker__detail .CertManager-row")) > 0 || undefined,
    );

    expect(await overflowsSideways(session, frame, ".CertManager-picker__detail")).toBeLessThan(8);
  }, 90_000);

  it("leaves the text of every clickable row where a reader expects it", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor(
      "the attention rows",
      async () => (await countOf(".CertManager-row")) > 0 || undefined,
    );

    for (const selector of [".CertManager-row", "button.CertManager-card"]) {
      expect(await computedStyle(session, frame, selector, "text-align"), selector).toMatch(
        /^(left|start)$/,
      );
    }

    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the picker",
      async () => (await countOf(".CertManager-picker__item")) > 0 || undefined,
    );

    expect(await computedStyle(session, frame, ".CertManager-picker__item", "text-align")).toMatch(
      /^(left|start)$/,
    );
  }, 90_000);

  it("takes its text colour from the host's theme rather than its own", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");

    const headline = await waitFor("the headline", async () => {
      const colour = await computedStyle(session, frame, ".CertManager-page__headline", "color");

      return colour.length > 0 ? colour : undefined;
    });

    expect(headline).toBe(await resolvedThemeColor(session, frame, "--textColorPrimary"));
  }, 90_000);

  it("sets its boxes on the host's grey, so they stand out in either theme", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor("the cards", async () => (await countOf(".CertManager-card")) > 0 || undefined);

    const surface = await resolvedThemeColor(session, frame, "--sidebarBackground");
    const page = await resolvedThemeColor(session, frame, "--contentColor");

    expect(surface, "the box and the page are the same colour").not.toBe(page);

    // `:not(:hover)`: Xvfb's pointer rests at the centre of the screen, which is
    // where the first attention row happens to be, and that row reads its hover
    // colour — the synthetic events these tests dispatch never move the real one.
    for (const selector of [".CertManager-card:not(:hover)", ".CertManager-row:not(:hover)"]) {
      expect(await computedStyle(session, frame, selector, "background-color"), selector).toBe(
        surface,
      );
    }

    await clickSidebar(session, frame, "cert-manager-issuers", "cert-manager");
    await waitFor("the issuers", async () => (await countOf(".CertManager-box")) > 0 || undefined);

    expect(
      await computedStyle(session, frame, ".CertManager-box:not(:hover)", "background-color"),
    ).toBe(surface);
  }, 90_000);

  it("draws the validity bar's now and renewal marks on its track", async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the picker",
      async () => (await countOf(".CertManager-picker__item")) > 0 || undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('.CertManager-picker__item')]
         .find((each) => /left$/.test(each.querySelector('.CertManager-picker__aside')?.textContent ?? ''))?.click()`,
      frame,
    );
    await waitFor(
      "a validity bar",
      async () => (await countOf(".CertManager-validity__now")) > 0 || undefined,
    );

    const placed = await session.evaluate<{ track: number[]; now: number; renewal: number }>(
      `(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const track = box('.CertManager-validity__track');
        const centre = (selector) => { const b = box(selector); return b.left + b.width / 2; };
        return {
          track: [track.left, track.right],
          now: centre('.CertManager-validity__now'),
          renewal: centre('.CertManager-validity__renewal'),
        };
      })()`,
      frame,
    );

    const [left = 0, right = 0] = placed.track;

    expect(right - left, "the track has no width").toBeGreaterThan(20);
    for (const mark of [placed.now, placed.renewal]) {
      expect(mark).toBeGreaterThanOrEqual(left - 1);
      expect(mark).toBeLessThanOrEqual(right + 1);
    }
  }, 90_000);
});
