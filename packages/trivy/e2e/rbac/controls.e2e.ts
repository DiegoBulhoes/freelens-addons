import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  type ErrorLog,
  openWorkbench,
  pressSort,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { checkLinks, expectEachToName } from "../support/trivy";

describe("the controls on the Trivy pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  describe("the RBAC list", () => {
    const ROW = ".Trivy-table tbody tr";
    const DRAWER = ".TrivyObjectDrawer";

    beforeAll(async () => {
      await clickSidebar(session, frame, "trivy-rbac", "trivy");
      await waitFor(
        "the checks",
        async () => (await countOf(session, frame, ROW)) > 0 || undefined,
      );
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
      const all = await countOf(session, frame, ROW);
      const [id] = await column("ID");

      expect(id, "no check id to search for").toBeTruthy();

      await typeInto(session, frame, ".Trivy-page__actions .Trivy-search", id as string);

      expect(
        await waitFor("the list to narrow", async () => {
          const rows = await countOf(session, frame, ROW);

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
          const rows = await countOf(session, frame, ROW);

          return rows === all ? rows : undefined;
        }),
      ).toBe(all);
    }, 90_000);

    it("sorts by a column, both ways, then back to its own order", async () => {
      const original = await column("Check");
      const sortBy = () => pressSort(session, frame, ".Trivy-table thead .Trivy-sort", "Roles");
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
        const rows = await countOf(session, frame, `${DRAWER} .Trivy-table tbody tr`);

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
    it("links an RBAC check from its drawer", async () => {
      await clickSidebar(session, frame, "trivy-rbac", "trivy");
      await waitFor(
        "the checks",
        async () => (await countOf(session, frame, ".Trivy-table tbody tr")) > 0 || undefined,
      );
      await session.evaluate("document.querySelector('.Trivy-table tbody tr')?.click()", frame);

      const found = await waitFor("the check's link", async () => {
        const here = await checkLinks(session, frame, ".TrivyObjectDrawer");

        return here.length > 0 ? here : undefined;
      });

      expectEachToName(found);
      expect(found).toHaveLength(1);
    }, 90_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
