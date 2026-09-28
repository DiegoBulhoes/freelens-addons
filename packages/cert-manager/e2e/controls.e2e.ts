import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  hoverForTooltip,
  notificationSaying,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * Every control the extension renders, pressed. A chip that lights and filters
 * nothing, a search field whose keystrokes never reach the rule, a copy button
 * that copies nothing: all of them render perfectly and all of them are useless.
 *
 * The one control that writes, the renewal, is pressed as far as its confirmation
 * and cancelled there: this suite stays read-only, and what the renewal sends is
 * covered by renewal.test.ts. That nothing was written is checked against the API.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

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

  const openPicker = async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the picker",
      async () => (await countOf(".CertManager-picker__item")) > 0 || undefined,
    );
  };

  const activeChip = () =>
    session.evaluate<string>(
      `[...document.querySelectorAll('.CertManager-filter')]
         .find((each) => each.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? ""`,
      frame,
    );

  describe("the picker's chips", () => {
    beforeAll(openPicker, 90_000);

    it("starts on All, and every narrower chip lights alone and shows no more", async () => {
      expect(await activeChip()).toBe("All");

      const all = await countOf(".CertManager-picker__item");
      const chips = await session.evaluate<string[]>(
        "[...document.querySelectorAll('.CertManager-filter')].map((each) => each.textContent.trim())",
        frame,
      );

      expect(chips.length).toBeGreaterThan(1);

      for (const chip of chips.slice(1)) {
        await clickByText(session, frame, ".CertManager-filter", chip);

        expect(await activeChip()).toBe(chip);
        expect(
          await countOf(".CertManager-picker__item"),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
      }

      await clickByText(session, frame, ".CertManager-filter", "All");
      expect(await countOf(".CertManager-picker__item")).toBe(all);
    }, 120_000);

    it("shows under Not ready only certificates the list marks as not ready", async () => {
      await clickByText(session, frame, ".CertManager-filter", "Not ready");

      const marks = await session.evaluate<string[]>(
        `[...document.querySelectorAll('.CertManager-picker__item .CertManager-picker__meta')]
           .map((each) => each.textContent)`,
        frame,
      );

      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) expect(mark).toMatch(/not ready|expired/);

      await clickByText(session, frame, ".CertManager-filter", "All");
    }, 90_000);
  });

  describe("the picker's search field", () => {
    beforeAll(openPicker, 90_000);

    it("narrows to a name that is on the list", async () => {
      const name = await textOf(
        session,
        frame,
        ".CertManager-picker__item .CertManager-picker__name",
      );

      await typeInto(session, frame, ".CertManager-search", name);

      const shown = await waitFor("the list to narrow", async () => {
        const names = await session.evaluate<string[]>(
          "[...document.querySelectorAll('.CertManager-picker__name')].map((each) => each.textContent.trim())",
          frame,
        );

        return names.every((each) => each.includes(name)) ? names : undefined;
      });

      expect(shown.length).toBeGreaterThan(0);
    }, 90_000);

    it("says so when nothing matches, and comes back when cleared", async () => {
      await typeInto(session, frame, ".CertManager-search", "no-certificate-is-called-this");

      expect(
        await waitFor("the empty note", async () => {
          const text = await textOf(session, frame, ".CertManager-picker__empty");

          return text.length > 0 ? text : undefined;
        }),
      ).toMatch(/Nothing matches/);

      await typeInto(session, frame, ".CertManager-search", "");
      expect(
        await waitFor(
          "the list back",
          async () => (await countOf(".CertManager-picker__item")) || undefined,
        ),
      ).toBeGreaterThan(0);
    }, 90_000);
  });

  describe("selecting a certificate", () => {
    beforeAll(openPicker, 90_000);

    it("puts it in the route and in the detail", async () => {
      const second = await session.evaluate<string>(
        "document.querySelectorAll('.CertManager-picker__item .CertManager-picker__name')[1]?.textContent.trim() ?? ''",
        frame,
      );

      await session.evaluate(
        "document.querySelectorAll('.CertManager-picker__item')[1]?.click()",
        frame,
      );

      const landed = await waitFor("the route to carry it", async () => {
        const path = await where();

        return path.includes(`name=${second}`) ? path : undefined;
      });

      expect(landed).toContain("namespace=");
      expect(
        await textOf(session, frame, ".CertManager-picker__detail .CertManager-page__headline"),
      ).toBe(second);
    }, 90_000);

    it("copies each command and says which", async () => {
      const commands = await session.evaluate<string[]>(
        "[...document.querySelectorAll('.CertManager-command__text')].map((each) => each.textContent.trim())",
        frame,
      );

      expect(commands.length).toBeGreaterThan(0);

      for (const [at, command] of commands.entries()) {
        await session.evaluate(
          `document.querySelectorAll('.CertManager-command .CertManager-icon-button')[${at}].click()`,
          frame,
        );

        expect(await notificationSaying(session, frame, command)).toContain(command);
      }
    }, 90_000);
  });

  describe("the renew button", () => {
    const select = async (predicate: string) => {
      await openPicker();
      const name = await session.evaluate<string>(
        `(() => {
          const item = [...document.querySelectorAll('.CertManager-picker__item')].find((each) => ${predicate});
          item?.click();
          return item?.querySelector('.CertManager-picker__name')?.textContent.trim() ?? "";
        })()`,
        frame,
      );

      expect(name, "no certificate in that state").not.toBe("");
      await waitFor("its detail", async () => {
        const headline = await textOf(
          session,
          frame,
          ".CertManager-picker__detail .CertManager-page__headline",
        );

        return headline === name ? headline : undefined;
      });

      return name;
    };

    const issuingOf = async (name: string) => {
      const certificates = await clusterItems<{
        metadata: { name: string };
        status?: { conditions?: { type: string; status: string }[] };
      }>(session, frame, "/apis/cert-manager.io/v1/certificates");

      return certificates
        .find((each) => each.metadata.name === name)
        ?.status?.conditions?.find((each) => each.type === "Issuing")?.status;
    };

    it("is offered for a healthy certificate, asks first, and writes nothing when cancelled", async () => {
      // No problem marked in the list, and time left: nothing is issuing it.
      const name = await select(
        `!each.querySelector('[class*="CertManager-text--"]') && /left$/.test(each.querySelector('.CertManager-picker__aside')?.textContent ?? '')`,
      );

      expect(
        await session.evaluate<boolean>(
          "document.querySelector('.CertManager-page__actions .CertManager-button').disabled",
          frame,
        ),
      ).toBe(false);

      const before = await issuingOf(name);

      await session.evaluate(
        "document.querySelector('.CertManager-page__actions .CertManager-button').click()",
        frame,
      );

      const question = await waitFor("the confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text.includes(name) ? text : undefined;
      });

      expect(question).toMatch(/stays in use/);

      await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the confirmation to close", async () =>
        (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
      );

      expect(await issuingOf(name)).toBe(before);
    }, 120_000);

    it("is not offered while cert-manager is already issuing, and says what holds it up", async () => {
      await select(
        `/not ready/.test(each.querySelector('.CertManager-picker__meta')?.textContent ?? '')`,
      );

      expect(
        await session.evaluate<boolean>(
          "document.querySelector('.CertManager-page__actions .CertManager-button').disabled",
          frame,
        ),
      ).toBe(true);
      expect(await textOf(session, frame, ".CertManager-page__actions .CertManager-hint")).toMatch(
        /already issuing/,
      );
    }, 90_000);
  });

  describe("the validity bar", () => {
    it("tells the renewal time on hover", async () => {
      await openPicker();
      // A certificate with a validity window: anything the list says has time left.
      await session.evaluate(
        `[...document.querySelectorAll('.CertManager-picker__item')]
           .find((each) => /left$/.test(each.querySelector('.CertManager-picker__aside')?.textContent ?? ''))?.click()`,
        frame,
      );
      await waitFor(
        "a validity bar",
        async () => (await countOf(".CertManager-validity__renewal")) > 0 || undefined,
      );

      const tooltip = await hoverForTooltip(
        session,
        frame,
        ".CertManager-validity__renewal [id^='tooltip_target_']",
      );

      expect(tooltip).toMatch(/^Renewal due \d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
    }, 90_000);

    it("writes each moment under the bar, with its date and how far it is", async () => {
      const moments = await session.evaluate<string[][]>(
        `[...document.querySelectorAll('.CertManager-validity__end')]
           .map((each) => [...each.children].map((part) => part.textContent.trim()))`,
        frame,
      );

      expect(moments.map((each) => each[0])).toEqual(["issued", "renewal due", "expires"]);

      for (const [, date, relative] of moments) {
        expect(date).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
        expect(relative).toMatch(/^(in \d+ \w+|\d+ \w+ ago|now)$/);
      }

      // Issued is behind us, and the certificate picked has time left.
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
      "takes %s to the picker with %s",
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
    it("opens a dependent certificate in the picker", async () => {
      await clickSidebar(session, frame, "cert-manager-issuers", "cert-manager");
      await waitFor(
        "a dependent",
        async () => (await countOf(".CertManager-box .CertManager-chip")) > 0 || undefined,
      );

      const name = await textOf(
        session,
        frame,
        ".CertManager-box .CertManager-chip > :first-child",
      );

      await session.evaluate(
        "document.querySelector('.CertManager-box .CertManager-chip').click()",
        frame,
      );

      expect(
        await waitFor("the picker on it", async () => {
          const headline = await textOf(
            session,
            frame,
            ".CertManager-picker__detail .CertManager-page__headline",
          );

          return headline === name ? headline : undefined;
        }),
      ).toBe(name);
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
});
