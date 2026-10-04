import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  drawerTitle,
  hoverForTooltip,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

const SERVED_ROWS = '[data-section="served"] tbody tr';
const LIST = '[data-section="cert-manager-certificates"]';
const ROWS = `${LIST} tbody tr`;
const ISSUER_ROWS = '[data-section="cert-manager-issuers"] tbody tr';
const DRAWER = ".CertManagerObjectDrawer";

describe("the controls on the cert-manager pages", () => {
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
      "location.pathname.replace('/extension/freelens-addons--cert-manager', '') + location.search",
      frame,
    );

  const openList = async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor("the certificates", async () => (await countOf(ROWS)) > 0 || undefined);
  };

  const names = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(`${ROWS} td:nth-child(2)`)})].map((each) => each.textContent.trim())`,
      frame,
    );

  const activeChip = () =>
    session.evaluate<string>(
      `[...document.querySelectorAll('.CertManager-filter')]
         .find((each) => each.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? ""`,
      frame,
    );

  describe("the certificates list's chips", () => {
    beforeAll(openList, 90_000);

    it("starts on All, and every narrower chip lights alone and shows no more", async () => {
      expect(await activeChip()).toBe("All");

      const all = await countOf(ROWS);
      const chips = await session.evaluate<string[]>(
        "[...document.querySelectorAll('.CertManager-filter')].map((each) => each.textContent.trim())",
        frame,
      );

      expect(chips.length).toBeGreaterThan(1);

      for (const chip of chips.slice(1)) {
        await clickByText(session, frame, ".CertManager-filter", chip);

        expect(await activeChip()).toBe(chip);
        expect(await countOf(ROWS), `${chip} showed more than All`).toBeLessThanOrEqual(all);
      }

      await clickByText(session, frame, ".CertManager-filter", "All");
      expect(await countOf(ROWS)).toBe(all);
    }, 120_000);

    it("shows under Not ready only certificates the list marks as not ready", async () => {
      await clickByText(session, frame, ".CertManager-filter", "Not ready");

      const marks = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${ROWS} .CertManager-status`)})].map((each) => each.textContent)`,
        frame,
      );

      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) expect(mark).toMatch(/not ready|expired/i);

      await clickByText(session, frame, ".CertManager-filter", "All");
    }, 90_000);
  });

  describe("the certificates list's search and sort", () => {
    beforeAll(openList, 90_000);

    it("narrows to a name that is on the list", async () => {
      const [name = ""] = await names();

      await typeInto(session, frame, ".CertManager-page__actions .CertManager-search", name);

      const shown = await waitFor("the list to narrow", async () => {
        const listed = await names();

        return listed.length > 0 && listed.every((each) => each.includes(name))
          ? listed
          : undefined;
      });

      expect(shown.length).toBeGreaterThan(0);
    }, 90_000);

    it("says so when nothing matches, and comes back when cleared", async () => {
      await typeInto(
        session,
        frame,
        ".CertManager-page__actions .CertManager-search",
        "no-certificate-is-called-this",
      );

      expect(
        await waitFor("the empty note", async () => {
          const text = await textOf(session, frame, `${LIST} .CertManager-section__note`);

          return text.length > 0 ? text : undefined;
        }),
      ).toMatch(/Nothing matches/);

      await typeInto(session, frame, ".CertManager-page__actions .CertManager-search", "");
      expect(
        await waitFor("the list back", async () => (await countOf(ROWS)) || undefined),
      ).toBeGreaterThan(0);
    }, 90_000);

    it("sorts by a header, and cycles back to the page's own order", async () => {
      const sortOf = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('${LIST} th')]
             .find((each) => each.textContent.trim() === "Certificate")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );
      const press = () =>
        clickByText(session, frame, `${LIST} th .CertManager-sort`, "Certificate");
      const own = await names();

      await press();
      expect(await sortOf()).toBe("ascending");
      expect(await names()).toEqual([...own].sort((a, b) => a.localeCompare(b)));

      await press();
      expect(await sortOf()).toBe("descending");

      await press();
      expect(await sortOf()).toBe("none");
      expect(await names()).toEqual(own);
    }, 90_000);
  });

  describe("the validity bar", () => {
    it("tells the renewal time on hover", async () => {
      await openList();
      await session.evaluate(
        `[...document.querySelectorAll(${JSON.stringify(ROWS)})]
           .find((each) => each.textContent.includes(' left') && each.querySelector('.CertManager-status--ok'))
           ?.querySelector('td:nth-child(2)').click()`,
        frame,
      );
      await waitFor(
        "a validity bar",
        async () => (await countOf(`${DRAWER} .CertManager-validity__renewal`)) > 0 || undefined,
      );

      const tooltip = await hoverForTooltip(
        session,
        frame,
        `${DRAWER} .CertManager-validity__renewal [id^='tooltip_target_']`,
      );

      expect(tooltip).toMatch(/^Renewal due \d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
    }, 90_000);

    it("writes each moment under the bar, with its date and how far it is", async () => {
      const moments = await session.evaluate<string[][]>(
        `[...document.querySelectorAll('${DRAWER} .CertManager-validity__end')]
           .map((each) => [...each.children].map((part) => part.textContent.trim()))`,
        frame,
      );

      expect(moments.map((each) => each[0])).toEqual(["issued", "renewal due", "expires"]);

      for (const [, date, relative] of moments) {
        expect(date).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
        expect(relative).toMatch(/^(in \d+ \w+|\d+ \w+ ago|now)$/);
      }

      expect(moments[0]?.[2]).toMatch(/ago$/);
      expect(moments[2]?.[2]).toMatch(/^in /);
    }, 90_000);
  });

  describe("the overview's cards", () => {
    it.each([
      ["Certificates", "filter=all"],
      ["Not ready", "filter=not-ready"],
      ["Renewal failing", "filter=failing"],
      ["Ending within 30 days", "filter=expiring"],
    ])(
      "takes %s to the certificates list with %s",
      async (label, filter) => {
        await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
        await waitFor(
          "the cards",
          async () => (await countOf("button.CertManager-card")) > 0 || undefined,
        );
        await clickByText(session, frame, "button.CertManager-card", label);

        const landed = await waitFor(`the list behind ${label}`, async () => {
          const path = await where();

          return path.startsWith("/certificates") ? path : undefined;
        });

        expect(landed).toContain(filter);
      },
      90_000,
    );

    it.each([
      ["Issuers not ready or missing", "/issuers"],
      ["Served TLS with no Certificate", "/unmanaged"],
    ])(
      "takes %s to %s",
      async (label, page) => {
        await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
        await waitFor(
          "the cards",
          async () => (await countOf("button.CertManager-card")) > 0 || undefined,
        );
        await clickByText(session, frame, "button.CertManager-card", label);

        expect(
          await waitFor(`the page behind ${label}`, async () =>
            (await where()) === page ? page : undefined,
          ),
        ).toBe(page);
      },
      90_000,
    );
  });

  describe("the issuers page", () => {
    it("opens a dependent certificate from an issuer's drawer", async () => {
      await clickSidebar(session, frame, "cert-manager-issuers", "cert-manager");
      await waitFor("the issuers", async () => (await countOf(ISSUER_ROWS)) > 0 || undefined);

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
      await waitFor("the requests", async () => (await countOf(".TableRow")) > 0 || undefined);

      const tooltip = await hoverForTooltip(session, frame, ".TableRow [id^='tooltip_target_']");

      expect(tooltip.length, "hovering a cell revealed no tooltip").toBeGreaterThan(0);
    }, 90_000);
  });

  describe("the labels", () => {
    it.each([
      ["cert-manager-overview", ".CertManager-card"],
      ["cert-manager-certificates", ROWS],
      ["cert-manager-issuers", ISSUER_ROWS],
      ["cert-manager-unmanaged", '[data-section="served"] tbody tr'],
    ])(
      "give every button on %s a tooltip, and none ends with dots",
      async (id, ready) => {
        await clickSidebar(session, frame, id, "cert-manager");
        await waitFor(`${id} to render`, async () => (await countOf(ready)) > 0 || undefined);

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

  describe("the unmanaged TLS page", () => {
    const openUnmanaged = async () => {
      await clickSidebar(session, frame, "cert-manager-unmanaged", "cert-manager");
      await waitFor("the served table", async () => (await countOf(SERVED_ROWS)) > 0 || undefined);
    };

    it("narrows both tables from its search, says so when nothing matches, and comes back", async () => {
      await openUnmanaged();
      const all = await countOf(SERVED_ROWS);
      const ingress = await textOf(session, frame, `${SERVED_ROWS} td:nth-child(2)`);

      await typeInto(session, frame, ".CertManager-page__actions .CertManager-search", ingress);

      const narrowed = await waitFor("the served table to narrow", async () => {
        const names = await session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${SERVED_ROWS} td:nth-child(2)`)})]
             .map((each) => each.textContent.trim())`,
          frame,
        );

        return names.length > 0 && names.every((each) => each.includes(ingress))
          ? names
          : undefined;
      });

      expect(narrowed.length).toBeLessThanOrEqual(all);
      expect(
        await textOf(session, frame, '[data-section="served"] .CertManager-section__note'),
      ).toMatch(/\d+ (of \d+ )?items?$/);

      await typeInto(
        session,
        frame,
        ".CertManager-page__actions .CertManager-search",
        "nothing-is-called-this",
      );
      expect(
        await waitFor("the empty note", async () => {
          const notes = await session.evaluate<string[]>(
            `[...document.querySelectorAll('.CertManager-section__note')].map((each) => each.textContent)`,
            frame,
          );

          return notes.filter((each) => each.includes("Nothing matches the search.")).length === 2
            ? true
            : undefined;
        }),
      ).toBe(true);

      await typeInto(session, frame, ".CertManager-page__actions .CertManager-search", "");
      expect(
        await waitFor("the table back", async () =>
          (await countOf(SERVED_ROWS)) === all ? all : undefined,
        ),
      ).toBe(all);
    }, 90_000);

    it("sorts by a header, and cycles back to the page's own order", async () => {
      await openUnmanaged();

      const order = () =>
        session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${SERVED_ROWS} td:nth-child(2)`)})]
             .map((each) => each.textContent.trim())`,
          frame,
        );
      const sortOf = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('[data-section="served"] th')]
             .find((each) => each.textContent.trim() === "Ingress")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );
      const press = () =>
        clickByText(session, frame, '[data-section="served"] th .CertManager-sort', "Ingress");

      const own = await order();

      await press();
      expect(await sortOf()).toBe("ascending");
      expect(await order()).toEqual([...own].sort((a, b) => a.localeCompare(b)));

      await press();
      expect(await sortOf()).toBe("descending");
      expect(await order()).toEqual([...own].sort((a, b) => b.localeCompare(a)));

      await press();
      expect(await sortOf()).toBe("none");
      expect(await order()).toEqual(own);
    }, 90_000);

    it("opens a served row in its drawer, and stays on the page", async () => {
      await openUnmanaged();
      const ingress = await textOf(session, frame, `${SERVED_ROWS} td:nth-child(2)`);

      await session.evaluate(
        `document.querySelector(${JSON.stringify(`${SERVED_ROWS} td:nth-child(2)`)}).click()`,
        frame,
      );

      expect(
        await waitFor("its drawer", async () => {
          const title = await drawerTitle(session, frame, DRAWER);

          return title === `Ingress: ${ingress}` ? title : undefined;
        }),
      ).toBe(`Ingress: ${ingress}`);
      expect(await where()).toBe("/unmanaged");
    }, 90_000);

    it("follows a row's Secret link to the host's list without opening the row", async () => {
      await openUnmanaged();

      const secret = await session.evaluate<string>(
        `(() => {
          const link = document.querySelector(${JSON.stringify(`${SERVED_ROWS} .CertManager-link`)});
          link?.click();
          return link?.textContent.trim() ?? "";
        })()`,
        frame,
      );

      expect(secret, "no served row links its Secret").not.toBe("");

      const landed = await waitFor("the host's Secrets list", async () => {
        const path = await session.evaluate<string>("location.pathname + location.search", frame);

        return path.startsWith("/secrets") ? path : undefined;
      });

      expect(decodeURIComponent(landed)).toContain(`search=${secret}`);
      expect(await countOf(`${DRAWER} [data-section="cert-manager-served"]`)).toBe(0);
    }, 90_000);
  });
});
