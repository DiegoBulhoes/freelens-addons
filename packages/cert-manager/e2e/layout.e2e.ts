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

const CERTIFICATE_ROWS = '[data-section="cert-manager-certificates"] tbody tr';
const DRAWER = ".CertManagerObjectDrawer";

const PAGES: [id: string, container: string][] = [
  ["cert-manager-overview", ".CertManager-page"],
  ["cert-manager-certificates", ".CertManager-page"],
  ["cert-manager-issuers", ".CertManager-page"],
  ["cert-manager-unmanaged", ".CertManager-page"],
];

const DESIGN: [id: string, ready: string][] = [
  ["cert-manager-overview", ".CertManager-row"],
  ["cert-manager-certificates", `${CERTIFICATE_ROWS}`],
  ["cert-manager-issuers", '[data-section="cert-manager-issuers"] tbody tr'],
  ["cert-manager-requests", ".CertManagerRequests .TableRow"],
  ["cert-manager-unmanaged", '[data-section="served"] tbody tr'],
];

describe("how the cert-manager pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

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

  const openCertificate = async (predicate: string) => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the certificates",
      async () => (await countOf(CERTIFICATE_ROWS)) > 0 || undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll(${JSON.stringify(CERTIFICATE_ROWS)})]
         .find((each) => ${predicate})?.querySelector('td:nth-child(2)').click()`,
      frame,
    );
  };

  it("keeps a certificate's drawer within its width, the long ACME reason included", async () => {
    await openCertificate("/Not ready/.test(each.textContent)");
    await waitFor(
      "its chain",
      async () =>
        (await countOf(`${DRAWER} [data-section="cert-manager-chain"] .CertManager-row`)) > 0 ||
        undefined,
    );

    expect(await overflowsSideways(session, frame, `${DRAWER} .CertManager-drawer`)).toBeLessThan(
      8,
    );
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

    // Xvfb's pointer rests over the first row, so a hovered element reads its hover colour.
    for (const selector of [".CertManager-card:not(:hover)", ".CertManager-row:not(:hover)"]) {
      expect(await computedStyle(session, frame, selector, "background-color"), selector).toBe(
        surface,
      );
    }
  }, 90_000);

  it("draws the validity bar's now and renewal marks on its track", async () => {
    await openCertificate(
      "each.querySelector('.CertManager-status--ok') && each.textContent.includes(' left')",
    );
    await waitFor(
      "a validity bar",
      async () => (await countOf(`${DRAWER} .CertManager-validity__now`)) > 0 || undefined,
    );

    const placed = await session.evaluate<{ track: number[]; now: number; renewal: number }>(
      `(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const track = box('.CertManagerObjectDrawer .CertManager-validity__track');
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
