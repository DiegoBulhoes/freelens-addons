import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  notificationText,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";
import { openScannedWorkload } from "./picker";

/**
 * Every control this extension renders, clicked.
 *
 * A chip that looks active and filters nothing, a tab that highlights and leaves
 * the table alone, a copy button that copies an empty string: all three render
 * perfectly and all three are useless. Nothing else in either suite presses them.
 *
 * Two controls are deliberately not here:
 *
 *   - The dashboard has none. Its cards are plain elements, unlike the ArgoCD
 *     ones, so there is nothing on it to press.
 *   - The coverage section's rows open a workload that has no verdict yet, and
 *     they exist only while the operator has one. On a cluster the scanner has
 *     finished with there are none to click, so a test for them would pass by
 *     finding nothing. `getCoverage` and `scan-progress.ts` cover the rule.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

describe("the controls on the Trivy pages", () => {
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

  const activeChip = (container: string) =>
    session.evaluate<string>(
      `(() => {
        const on = [...document.querySelectorAll(${JSON.stringify(`${container} button`)})]
          .find((each) => each.getAttribute("aria-pressed") === "true");
        return on ? on.textContent.trim() : "";
      })()`,
      frame,
    );

  describe("the workload picker's filter chips", () => {
    const SIDE = ".Trivy-picker__side .Trivy-filters";

    beforeAll(async () => {
      await clickSidebar(session, frame, "trivy-workloads", "trivy");
      await waitFor(
        "the picker",
        async () => (await countOf(".Trivy-picker__item")) > 0 || undefined,
      );
    }, 90_000);

    it("starts on All, and All is the widest", async () => {
      expect(await activeChip(SIDE)).toBe("All");

      const all = await countOf(".Trivy-picker__item");

      for (const chip of ["No verdict", "Findings"]) {
        await clickByText(session, frame, `${SIDE} button`, chip);

        expect(await activeChip(SIDE), `${chip} did not become the active chip`).toBe(chip);

        // A narrower chip cannot show more than All did. Asserting a number
        // instead would be asserting this cluster's contents.
        expect(
          await countOf(".Trivy-picker__item"),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
      }

      await clickByText(session, frame, `${SIDE} button`, "All");
      expect(await countOf(".Trivy-picker__item")).toBe(all);
    }, 90_000);

    it("shows under No verdict exactly the workloads All marks as unjudged", async () => {
      const unjudged = () =>
        session.evaluate<string[]>(
          `[...document.querySelectorAll('.Trivy-picker__item')]
             .filter((each) => !/· scanned$/.test(each.querySelector('.Trivy-picker__meta')?.textContent.trim() ?? ''))
             .map((each) => each.querySelector('.Trivy-picker__name')?.textContent.trim())`,
          frame,
        );

      await clickByText(session, frame, `${SIDE} button`, "All");
      const expected = await unjudged();

      // The chip's promise: nothing the scanner has already judged, and nothing
      // it has not left out. Compared with the list rather than asserted
      // non-empty, since a cluster whose scans have all finished has none.
      await clickByText(session, frame, `${SIDE} button`, "No verdict");

      try {
        expect(await countOf(".Trivy-picker__item")).toBe(expected.length);
        expect(await unjudged()).toEqual(expected);
      } finally {
        await clickByText(session, frame, `${SIDE} button`, "All");
      }
    }, 90_000);
  });

  describe("the overview's most exposed workloads", () => {
    it("lists them by critical findings, and opens each on its detail", async () => {
      await clickSidebar(session, frame, "trivy-dashboard", "trivy");
      await waitFor("the list", async () => (await countOf(".Trivy-row")) > 0 || undefined);

      // Only the counts: while something waits on a verdict, the coverage rows
      // above are critical too, and their state is words.
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
        await waitFor("that workload's detail", async () => {
          const headline = await textOf(
            session,
            frame,
            ".Trivy-picker__detail .Trivy-page__headline",
          );

          return headline === name ? headline : undefined;
        }),
      ).toBe(name);
    }, 90_000);
  });

  describe("the workload detail's views", () => {
    const TABS = ".Trivy-picker__detail .Trivy-filters";

    beforeAll(async () => {
      await openScannedWorkload(session, frame);
    }, 90_000);

    it("opens on packages and switches to findings", async () => {
      expect(await activeChip(TABS)).toBe("By package");
      expect(await textOf(session, frame, ".Trivy-picker__detail .Trivy-section__title")).toBe(
        "Packages to upgrade",
      );

      await clickByText(session, frame, `${TABS} button`, "All ");

      const title = await waitFor("the findings title", async () => {
        const text = await textOf(session, frame, ".Trivy-picker__detail .Trivy-section__title");

        return text === "Findings" ? text : undefined;
      });

      expect(title).toBe("Findings");

      // The findings table names the CVE; the package table does not, so this is
      // the column that says which of the two is rendered.
      const columns = await session.evaluate<string[]>(
        `[...document.querySelectorAll('.Trivy-picker__detail .Trivy-table thead th')]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      expect(columns).toContain("CVE");
    }, 90_000);

    it("narrows to what has no fix, and cannot show more than all of them", async () => {
      await clickByText(session, frame, `${TABS} button`, "All ");
      const all = await countOf(".Trivy-picker__detail .Trivy-table tbody tr");

      await clickByText(session, frame, `${TABS} button`, "No fix");

      expect(await activeChip(TABS)).toContain("No fix");
      expect(await countOf(".Trivy-picker__detail .Trivy-table tbody tr")).toBeLessThanOrEqual(all);

      const fixes = await session.evaluate<string[]>(
        `[...document.querySelectorAll('.Trivy-picker__detail .Trivy-table tbody tr td:last-child')]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      for (const fix of fixes) expect(fix).toBe("none published");
    }, 90_000);

    it("copies a ticket and says that it did", async () => {
      await clickByText(session, frame, ".Trivy-picker__detail .Trivy-button", "Copy for a ticket");

      // The clipboard itself needs a permission this frame has not been granted,
      // so what is checked is the promise the button makes to the operator.
      expect(await notificationText(session, frame)).toMatch(/copied/i);
    }, 90_000);
  });

  describe("the RBAC page's check groups", () => {
    beforeAll(async () => {
      await clickSidebar(session, frame, "trivy-rbac", "trivy");
      await waitFor("the checks", async () => (await countOf(".Trivy-box")) > 0 || undefined);
    }, 90_000);

    /** The index of the first group holding more roles than it shows. */
    const groupWithMore = () =>
      session.evaluate<number>(
        `[...document.querySelectorAll('.Trivy-box')]
           .findIndex((each) => each.querySelector('button.Trivy-chip'))`,
        frame,
      );

    const rolesIn = (index: number) =>
      session.evaluate<number>(
        `document.querySelectorAll('.Trivy-box')[${index}]?.querySelectorAll('span.Trivy-chip').length ?? -1`,
        frame,
      );

    it("opens a group to name every role it found, and closes it again", async () => {
      // A group short enough to list in full has nothing to reveal, so this picks
      // one that is holding roles back.
      const index = await groupWithMore();

      expect(index, "no check group has more roles than it shows").toBeGreaterThanOrEqual(0);

      const shown = await rolesIn(index);

      await session.evaluate(
        `document.querySelectorAll('.Trivy-box')[${index}].querySelector('.Trivy-box__head').click()`,
        frame,
      );

      const opened = await waitFor("the rest of the roles", async () => {
        const roles = await rolesIn(index);

        return roles > shown ? roles : undefined;
      });

      expect(opened).toBeGreaterThan(shown);

      // The count in the head is the promise: opening shows exactly that many.
      const promised = await session.evaluate<number>(
        `Number.parseInt(document.querySelectorAll('.Trivy-box')[${index}]
           .querySelector('.Trivy-box__count').textContent, 10)`,
        frame,
      );

      expect(opened).toBe(promised);

      await session.evaluate(
        `document.querySelectorAll('.Trivy-box')[${index}].querySelector('.Trivy-box__head').click()`,
        frame,
      );

      const closed = await waitFor("the group to close", async () => {
        const roles = await rolesIn(index);

        return roles === shown ? roles : undefined;
      });

      expect(closed).toBe(shown);
    }, 120_000);

    it("keeps one group open at a time", async () => {
      const index = await groupWithMore();
      const head = (at: number) =>
        session.evaluate(
          `document.querySelectorAll('.Trivy-box')[${at}].querySelector('.Trivy-box__head').click()`,
          frame,
        );

      await head(index);
      const opened = await rolesIn(index);

      // Opening another one has to close this one, or the page grows without
      // bound as an operator reads down it.
      const other = index === 0 ? 1 : 0;

      await head(other);

      const collapsed = await waitFor("the first group to close", async () => {
        const roles = await rolesIn(index);

        return roles < opened ? roles : undefined;
      });

      expect(collapsed).toBeLessThan(opened);
    }, 120_000);

    it("reaches the same state from the 'and more' button", async () => {
      const index = await groupWithMore();

      expect(index).toBeGreaterThanOrEqual(0);

      const shown = await rolesIn(index);

      await session.evaluate(
        `document.querySelectorAll('.Trivy-box')[${index}].querySelector('button.Trivy-chip').click()`,
        frame,
      );

      const opened = await waitFor("the group to open from the count", async () => {
        const roles = await rolesIn(index);

        return roles > shown ? roles : undefined;
      });

      expect(opened).toBeGreaterThan(shown);
    }, 120_000);
  });

  // Not followed: it leaves the app. What is checked is that each link names
  // the check it sits beside and points at that check's page in the database.
  describe("the links to where a check is explained", () => {
    const links = (container: string) =>
      session.evaluate<{ text: string; href: string; target: string }[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${container} a[href*="avd.aquasec.com"]`)})]
           .map((each) => ({ text: each.textContent.trim(), href: each.href, target: each.target }))`,
        frame,
      );

    const expectEachToName = (found: { text: string; href: string; target: string }[]) => {
      expect(found.length, "no check carries a link").toBeGreaterThan(0);

      for (const link of found) {
        expect(link.text).toMatch(/^AVD-[A-Z]+-\d+$/);
        expect(link.href).toBe(`https://avd.aquasec.com/misconfig/${link.text.toLowerCase()}`);
        expect(link.target, "a link that replaces the app's own window").toBe("_blank");
      }
    };

    it("links every RBAC check", async () => {
      await clickSidebar(session, frame, "trivy-rbac", "trivy");
      await waitFor("the checks", async () => (await countOf(".Trivy-box")) > 0 || undefined);

      expectEachToName(await links(".Trivy-box"));
      expect(await countOf(".Trivy-box a")).toBe(await countOf(".Trivy-box"));
    }, 90_000);

    it("links the failed config checks of a workload", async () => {
      await clickSidebar(session, frame, "trivy-workloads", "trivy");

      const found = await waitFor("a workload with failed checks", async () => {
        const count = await countOf(".Trivy-picker__item");

        for (let at = 0; at < count; at += 1) {
          await session.evaluate(
            `document.querySelectorAll('.Trivy-picker__item')[${at}].click()`,
            frame,
          );
          await new Promise((resolve) => setTimeout(resolve, 600));

          const here = await links(".Trivy-picker__detail .Trivy-row");

          if (here.length > 0) return here;
        }

        return undefined;
      });

      expectEachToName(found);
    }, 150_000);
  });
});
