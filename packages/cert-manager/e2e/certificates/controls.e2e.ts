import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  type ErrorLog,
  hoverForTooltip,
  openWorkbench,
  pressChip,
  pressSort,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { CERTIFICATE_ROWS, DRAWER, LIST } from "../support/lists";

describe("the controls on the cert-manager pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const openList = async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the certificates",
      async () => (await countOf(session, frame, CERTIFICATE_ROWS)) > 0 || undefined,
    );
  };

  const names = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(`${CERTIFICATE_ROWS} td:nth-child(2)`)})].map((each) => each.textContent.trim())`,
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

      const all = await countOf(session, frame, CERTIFICATE_ROWS);
      const chips = await session.evaluate<string[]>(
        "[...document.querySelectorAll('.CertManager-filter')].map((each) => each.textContent.trim())",
        frame,
      );

      expect(chips.length).toBeGreaterThan(1);

      for (const chip of chips.slice(1)) {
        await pressChip(session, frame, ".CertManager-filter", chip);

        expect(await activeChip()).toBe(chip);
        expect(
          await countOf(session, frame, CERTIFICATE_ROWS),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
      }

      await pressChip(session, frame, ".CertManager-filter", "All");
      expect(await countOf(session, frame, CERTIFICATE_ROWS)).toBe(all);
    }, 120_000);

    it("shows under Not ready only certificates the list marks as not ready", async () => {
      await pressChip(session, frame, ".CertManager-filter", "Not ready");

      const marks = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${CERTIFICATE_ROWS} .CertManager-status`)})].map((each) => each.textContent)`,
        frame,
      );

      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) expect(mark).toMatch(/not ready|expired/i);

      await pressChip(session, frame, ".CertManager-filter", "All");
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
        await waitFor(
          "the list back",
          async () => (await countOf(session, frame, CERTIFICATE_ROWS)) || undefined,
        ),
      ).toBeGreaterThan(0);
    }, 90_000);

    it("sorts by a header, and cycles back to the page's own order", async () => {
      const sortOf = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('${LIST} th')]
             .find((each) => each.textContent.trim() === "Certificate")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );
      const press = () => pressSort(session, frame, `${LIST} th .CertManager-sort`, "Certificate");
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
        `[...document.querySelectorAll(${JSON.stringify(CERTIFICATE_ROWS)})]
           .find((each) => each.textContent.includes(' left') && each.querySelector('.CertManager-status--ok'))
           ?.querySelector('td:nth-child(2)').click()`,
        frame,
      );
      await waitFor(
        "a validity bar",
        async () =>
          (await countOf(session, frame, `${DRAWER} .CertManager-validity__renewal`)) > 0 ||
          undefined,
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

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
