import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  notificationText,
  openDrawer,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";
import {
  BODY,
  CHIPS,
  closeDrawer,
  column,
  DRAWER,
  drawerTitle,
  openRow,
  openScannedWorkload,
  openWorkloads,
  ROW,
} from "./workloads";

// Coverage rows are not clicked: they exist only while a scan is pending.

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

  describe("the workload list's filter chips", () => {
    beforeAll(async () => {
      await openWorkloads(session, frame);
    }, 90_000);

    it("starts on All, and All is the widest", async () => {
      expect(await activeChip(CHIPS)).toBe("All");

      const all = await countOf(ROW);

      for (const chip of ["No verdict", "Findings"]) {
        await clickByText(session, frame, `${CHIPS} button`, chip);

        expect(await activeChip(CHIPS), `${chip} did not become the active chip`).toBe(chip);

        // Compared with All, not a number: a number would be this cluster's contents.
        expect(await countOf(ROW), `${chip} showed more than All`).toBeLessThanOrEqual(all);
      }

      await clickByText(session, frame, `${CHIPS} button`, "All");
      expect(await countOf(ROW)).toBe(all);
    }, 90_000);

    it("shows under No verdict exactly the workloads All marks as unjudged", async () => {
      const unjudged = async () => {
        const names = await column(session, frame, "Workload");
        const states = await column(session, frame, "Coverage");

        return names.filter((_, at) => states[at] !== "scanned");
      };

      await clickByText(session, frame, `${CHIPS} button`, "All");
      const expected = await unjudged();

      // Compared with the list, not non-empty: a fully scanned cluster has none.
      await clickByText(session, frame, `${CHIPS} button`, "No verdict");

      try {
        expect(await countOf(ROW)).toBe(expected.length);
        expect(await unjudged()).toEqual(expected);
      } finally {
        await clickByText(session, frame, `${CHIPS} button`, "All");
      }
    }, 90_000);

    it("sorts by criticals both ways, then back to its own order", async () => {
      const original = await column(session, frame, "Workload");
      const sortBy = () =>
        clickByText(session, frame, ".Trivy-page--list .Trivy-table thead .Trivy-sort", "Critical");
      // An unjudged workload has no count, and goes last either way.
      const counts = async () =>
        (await column(session, frame, "Critical")).filter((each) => each !== "—").map(Number);

      await sortBy();
      const ascending = await counts();

      expect(ascending).toEqual([...ascending].sort((first, second) => first - second));

      await sortBy();
      const descending = await counts();

      expect(descending).toEqual([...descending].sort((first, second) => second - first));
      const cells = await column(session, frame, "Critical");

      if (cells.includes("—")) expect(cells.at(-1), "an unjudged count sorted first").toBe("—");

      await sortBy();
      expect(await column(session, frame, "Workload")).toEqual(original);
    }, 90_000);
  });

  describe("a row of the workload list", () => {
    it("opens that workload's drawer, and another row switches it without closing", async () => {
      await openWorkloads(session, frame);

      const names = await column(session, frame, "Workload");

      expect(names.length, "only one workload to switch to").toBeGreaterThan(1);

      const kinds = await column(session, frame, "Kind");

      await openRow(session, frame, 0);
      expect(await drawerTitle(session, frame)).toBe(`${kinds[0]}: ${names[0]}`);

      await openRow(session, frame, 1);
      expect(await drawerTitle(session, frame)).toBe(`${kinds[1]}: ${names[1]}`);
      expect(await countOf(BODY)).toBe(1);

      await closeDrawer(session, frame);
    }, 90_000);

    it("holds more than the row: its state, its facts, its pods, containers and config", async () => {
      await openScannedWorkload(session, frame);

      expect(await countOf(`${BODY} .Trivy-banner, ${BODY} > p.Trivy-muted`)).toBe(1);

      const facts = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${BODY} > .Trivy-facts > dt`)})].map((each) => each.textContent.trim())`,
        frame,
      );

      expect(facts).toEqual(["Namespace", "Coverage", "Findings", "Fix published", "Last scan"]);

      for (const section of [
        "trivy-workload-findings",
        "trivy-workload-pods",
        "trivy-workload-containers",
        "trivy-workload-config",
      ]) {
        expect(await countOf(`${BODY} [data-section="${section}"]`), `no ${section}`).toBe(1);
      }

      await closeDrawer(session, frame);
    }, 90_000);

    it("says an unjudged workload is not known to be clean, and lists no findings", async () => {
      await openWorkloads(session, frame);

      const states = await column(session, frame, "Coverage");
      const index = states.findIndex((state) => state !== "scanned");

      // A fully scanned cluster has none to open.
      if (index < 0) return;

      await openRow(session, frame, index);

      expect(await textOf(session, frame, BODY)).toMatch(/does not mean it is clean/);
      expect(await countOf(`${BODY} [data-section="trivy-workload-findings"]`)).toBe(0);

      await closeDrawer(session, frame);
    }, 90_000);
  });

  describe("the overview's most exposed workloads", () => {
    it("lists them by critical findings, and opens each on its drawer", async () => {
      await clickSidebar(session, frame, "trivy-dashboard", "trivy");
      await waitFor("the list", async () => (await countOf(".Trivy-row")) > 0 || undefined);

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
      expect(await countOf(ROW)).toBeGreaterThan(0);

      await closeDrawer(session, frame);
    }, 90_000);
  });

  describe("the workload drawer's views", () => {
    const TABS = `${BODY} [data-section="trivy-workload-findings"] .Trivy-filters`;
    const TABLE = `${BODY} [data-section="trivy-workload-findings"] .Trivy-table`;
    const TITLE = `${BODY} [data-section="trivy-workload-findings"] .Trivy-section__title`;

    beforeAll(async () => {
      await openScannedWorkload(session, frame);
    }, 90_000);

    afterAll(async () => {
      await closeDrawer(session, frame);
    }, 30_000);

    it("opens on packages and switches to findings", async () => {
      expect(await activeChip(TABS)).toBe("By package");
      expect(await textOf(session, frame, TITLE)).toBe("Packages to upgrade");

      await clickByText(session, frame, `${TABS} button`, "All ");

      const title = await waitFor("the findings title", async () => {
        const text = await textOf(session, frame, TITLE);

        return text === "Findings" ? text : undefined;
      });

      expect(title).toBe("Findings");

      // Only the findings table has a CVE column.
      const columns = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${TABLE} thead th`)})]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      expect(columns).toContain("CVE");
    }, 90_000);

    it("narrows to what has no fix, and cannot show more than all of them", async () => {
      await clickByText(session, frame, `${TABS} button`, "All ");
      const all = await countOf(`${TABLE} tbody tr`);

      await clickByText(session, frame, `${TABS} button`, "No fix");

      expect(await activeChip(TABS)).toContain("No fix");
      expect(await countOf(`${TABLE} tbody tr`)).toBeLessThanOrEqual(all);

      const fixes = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${TABLE} tbody tr td:last-child`)})]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      for (const fix of fixes) expect(fix).toBe("none published");
    }, 90_000);

    it("copies a ticket from the title bar and says that it did", async () => {
      await session.evaluate(
        `[...(${openDrawer(DRAWER)}?.querySelectorAll('.drawer-title i.Icon') ?? [])]
           .find((each) => !each.closest('.drawer-title-text') && each.textContent.trim() === "content_copy")?.click()`,
        frame,
      );

      // The clipboard needs a permission this frame lacks, so check the notification.
      expect(await notificationText(session, frame)).toMatch(/copied/i);
    }, 90_000);
  });

  describe("the overview's cards", () => {
    const openFromCard = async (label: string) => {
      await clickSidebar(session, frame, "trivy-dashboard", "trivy");
      await waitFor("the cards", async () => (await countOf("button.Trivy-card")) > 0 || undefined);
      await clickByText(session, frame, "button.Trivy-card", label);
      await waitFor("the workload list", async () => (await countOf(ROW)) > 0 || undefined);
    };

    it("opens Workloads on every workload from the count of them", async () => {
      await openFromCard("Workloads known");

      expect(await activeChip(CHIPS)).toBe("All");
      expect(await countOf(BODY), "a card opened a drawer").toBe(0);
    }, 90_000);

    it("opens Workloads on those with findings from a count of findings", async () => {
      await openFromCard("Critical, fix published");

      try {
        expect(await activeChip(CHIPS)).toBe("Findings");
      } finally {
        // The page may stay mounted with its filter set.
        await clickByText(session, frame, `${CHIPS} button`, "All");
      }
    }, 90_000);
  });

  describe("the RBAC list", () => {
    const ROW = ".Trivy-table tbody tr";
    const DRAWER = ".TrivyObjectDrawer";

    beforeAll(async () => {
      await clickSidebar(session, frame, "trivy-rbac", "trivy");
      await waitFor("the checks", async () => (await countOf(ROW)) > 0 || undefined);
    }, 90_000);

    const column = (title: string) =>
      session.evaluate<string[]>(
        `(() => {
          const at = [...document.querySelectorAll('.Trivy-table thead th')]
            .map((each) => each.textContent.trim().replace(/[▲▼]/g, "").trim())
            .indexOf(${JSON.stringify(title)});
          return [...document.querySelectorAll(${JSON.stringify(ROW)})]
            .map((row) => row.children[at]?.textContent.trim() ?? "");
        })()`,
        frame,
      );

    const count = () => textOf(session, frame, ".Trivy-page__count");

    it("narrows to a check by its id, counts what is left, and comes back", async () => {
      const all = await countOf(ROW);
      const [id] = await column("ID");

      expect(id, "no check id to search for").toBeTruthy();

      await typeInto(session, frame, ".Trivy-page__actions .Trivy-search", id as string);

      expect(
        await waitFor("the list to narrow", async () => {
          const rows = await countOf(ROW);

          return rows > 0 && rows < all ? rows : undefined;
        }),
      ).toBe(1);
      expect(await count()).toBe(`1 of ${all} items`);

      await typeInto(
        session,
        frame,
        ".Trivy-page__actions .Trivy-search",
        "no-check-is-called-this",
      );
      expect(
        await waitFor("the empty note", async () => {
          const text = await textOf(session, frame, ".Trivy-section__note");

          return text.length > 0 ? text : undefined;
        }),
      ).toMatch(/Nothing matches/);

      await typeInto(session, frame, ".Trivy-page__actions .Trivy-search", "");
      expect(
        await waitFor("the list to return", async () => {
          const rows = await countOf(ROW);

          return rows === all ? rows : undefined;
        }),
      ).toBe(all);
    }, 90_000);

    it("sorts by a column, both ways, then back to its own order", async () => {
      const original = await column("Check");
      const sortBy = () => clickByText(session, frame, ".Trivy-table thead .Trivy-sort", "Roles");
      const numbers = async () => (await column("Roles")).map((each) => Number(each));

      await sortBy();
      const ascending = await numbers();

      expect(ascending).toEqual([...ascending].sort((first, second) => first - second));

      await sortBy();
      const descending = await numbers();

      expect(descending).toEqual([...descending].sort((first, second) => second - first));

      await sortBy();
      expect(await column("Check")).toEqual(original);
    }, 90_000);

    it("opens a check's drawer naming exactly the roles its row counts", async () => {
      const roles = (await column("Roles")).map(Number);
      const clusterRoles = (await column("ClusterRoles")).map(Number);
      const [title] = await column("Check");

      await session.evaluate(`document.querySelector(${JSON.stringify(ROW)})?.click()`, frame);

      const listed = await waitFor("the drawer's roles", async () => {
        const rows = await countOf(`${DRAWER} .Trivy-table tbody tr`);

        return rows > 0 ? rows : undefined;
      });

      expect(listed).toBe((roles[0] ?? 0) + (clusterRoles[0] ?? 0));
      expect(await textOf(session, frame, DRAWER)).toContain(title as string);
    }, 90_000);

    it("switches the drawer to another check from its row, without closing it", async () => {
      const titles = await column("Check");

      expect(titles.length, "only one check to switch to").toBeGreaterThan(1);

      await session.evaluate(
        `document.querySelectorAll(${JSON.stringify(ROW)})[1]?.click()`,
        frame,
      );

      expect(
        await waitFor("the second check's drawer", async () =>
          (await textOf(session, frame, DRAWER)).includes(titles[1] as string) ? true : undefined,
        ),
      ).toBe(true);
    }, 90_000);
  });

  // Not followed: it leaves the app.
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

    it("links an RBAC check from its drawer", async () => {
      await clickSidebar(session, frame, "trivy-rbac", "trivy");
      await waitFor(
        "the checks",
        async () => (await countOf(".Trivy-table tbody tr")) > 0 || undefined,
      );
      await session.evaluate("document.querySelector('.Trivy-table tbody tr')?.click()", frame);

      const found = await waitFor("the check's link", async () => {
        const here = await links(".TrivyObjectDrawer");

        return here.length > 0 ? here : undefined;
      });

      expectEachToName(found);
      expect(found).toHaveLength(1);
    }, 90_000);

    it("links the failed config checks of a workload", async () => {
      const rows = await openWorkloads(session, frame);

      const found = await waitFor("a workload with failed checks", async () => {
        for (let at = 0; at < rows; at += 1) {
          await openRow(session, frame, at);
          await new Promise((resolve) => setTimeout(resolve, 600));

          const here = await links(`${BODY} [data-section="trivy-workload-config"] .Trivy-row`);

          if (here.length > 0) return here;
        }

        return undefined;
      });

      expectEachToName(found);
      await closeDrawer(session, frame);
    }, 150_000);
  });
});
