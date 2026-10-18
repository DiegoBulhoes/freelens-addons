import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  drawerTitle,
  type ErrorLog,
  hoverForTooltip,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { where as pageWhere } from "../support/cert-manager";
import { CERTIFICATE_ROWS, DRAWER, ISSUER_ROWS, SERVED_ROWS } from "../support/lists";

describe("the controls on the cert-manager pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const where = () => pageWhere(session, frame);

  describe("the overview's cards", () => {
    it.each([
      ["Certificates", "filter=all"],
      ["Not ready", "filter=not-ready"],
      ["Renewal failing", "filter=failing"],
      ["Ends within 30 days", "filter=expiring"],
    ])(
      "takes %s to the certificates list with %s",
      async (label, filter) => {
        await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
        await waitFor(
          "the cards",
          async () => (await countOf(session, frame, "button.CertManager-card")) > 0 || undefined,
        );
        await clickWhenShown(session, frame, "button.CertManager-card", label);

        const landed = await waitFor(`the list behind ${label}`, async () => {
          const path = await where();

          return path.startsWith("/certificates") ? path : undefined;
        });

        expect(landed).toContain(filter);
      },
      90_000,
    );

    it.each([
      ["Issuers not ready or missing", "/issuers", "filter=trouble"],
      ["Served TLS with no Certificate", "/unmanaged", "filter=gaps"],
    ])(
      "takes %s to %s with %s",
      async (label, page, filter) => {
        await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
        await waitFor(
          "the cards",
          async () => (await countOf(session, frame, "button.CertManager-card")) > 0 || undefined,
        );
        await clickWhenShown(session, frame, "button.CertManager-card", label);

        const landed = await waitFor(`the page behind ${label}`, async () => {
          const path = await where();

          return path.startsWith(page) ? path : undefined;
        });

        expect(landed).toContain(filter);
      },
      90_000,
    );
  });

  describe("the issuers page", () => {
    it("opens a dependent certificate from an issuer's drawer", async () => {
      await clickSidebar(session, frame, "cert-manager-issuers", "cert-manager");
      await waitFor(
        "the issuers",
        async () => (await countOf(session, frame, ISSUER_ROWS)) > 0 || undefined,
      );

      // The Certificates column: a row whose count is not zero has a dependent.
      expect(
        await session.evaluate<boolean>(
          `(() => {
            const row = [...document.querySelectorAll(${JSON.stringify(ISSUER_ROWS)})]
              .find((each) => Number(each.querySelector('.CertManager-table__number')?.textContent) > 0);
            row?.querySelector('td').click();
            return Boolean(row);
          })()`,
          frame,
        ),
      ).toBe(true);

      const dependents = `${DRAWER} [data-section="cert-manager-issuer-dependents"] .CertManager-row`;
      const name = await waitFor("a dependent", async () => {
        const text = await textOf(session, frame, `${dependents} b`);

        return text.length > 0 ? text : undefined;
      });

      await session.evaluate(
        `document.querySelector(${JSON.stringify(dependents)}).click()`,
        frame,
      );

      expect(
        await waitFor("its drawer on the certificates list", async () => {
          const title = await drawerTitle(session, frame, DRAWER);

          return title === `Certificate: ${name}` ? title : undefined;
        }),
      ).toBe(`Certificate: ${name}`);
      expect(await where()).toContain("/certificates");
    }, 90_000);
  });

  describe("the requests list", () => {
    it("explains a request's state on hover", async () => {
      await clickSidebar(session, frame, "cert-manager-requests", "cert-manager");
      await waitFor(
        "the requests",
        async () => (await countOf(session, frame, ".TableRow")) > 0 || undefined,
      );

      const tooltip = await hoverForTooltip(session, frame, ".TableRow [id^='tooltip_target_']");

      expect(tooltip.length, "hovering a cell revealed no tooltip").toBeGreaterThan(0);
    }, 90_000);

    it("opens a request's Certificate in its drawer, not the request's details", async () => {
      await clickSidebar(session, frame, "cert-manager-requests", "cert-manager");
      await waitFor(
        "the requests",
        async () => (await countOf(session, frame, ".TableRow")) > 0 || undefined,
      );

      const name = await session.evaluate<string>(
        `(() => {
          const link = document.querySelector('.TableRow .CertManager-link');
          link?.click();
          return link?.textContent.trim() ?? "";
        })()`,
        frame,
      );

      expect(name, "no request names its Certificate").not.toBe("");
      expect(
        await waitFor("its drawer on the certificates list", async () => {
          const title = await drawerTitle(session, frame, DRAWER);

          return title === `Certificate: ${name}` ? title : undefined;
        }),
      ).toBe(`Certificate: ${name}`);
      expect(await where()).toContain("/certificates");
    }, 90_000);
  });

  describe("the labels", () => {
    it.each([
      ["cert-manager-overview", ".CertManager-card"],
      ["cert-manager-certificates", CERTIFICATE_ROWS],
      ["cert-manager-issuers", ISSUER_ROWS],
      ["cert-manager-unmanaged", SERVED_ROWS],
    ])(
      "give every button on %s a tooltip, and none ends with dots",
      async (id, ready) => {
        await clickSidebar(session, frame, id, "cert-manager");
        await waitFor(
          `${id} to render`,
          async () => (await countOf(session, frame, ready)) > 0 || undefined,
        );

        const buttons = await session.evaluate<{ text: string; title: string }[]>(
          `[...document.querySelectorAll('.CertManager button')]
             .map((each) => ({ text: each.textContent.trim(), title: each.title }))`,
          frame,
        );

        expect(buttons.length).toBeGreaterThan(0);
        expect(buttons.filter((each) => !each.title)).toEqual([]);
        expect(buttons.filter((each) => /(\.\.\.|…)$/.test(each.text))).toEqual([]);
      },
      90_000,
    );
  });

  it("works every control without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
