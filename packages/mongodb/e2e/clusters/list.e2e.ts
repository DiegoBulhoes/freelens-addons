import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  type ErrorLog,
  pressChip,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { CHIPS, DRAWER, openSuite, pagesOn, ROWS } from "../support/mongodb";

// Read-only: cards, chips, rows, search and links only navigate.

describe("the controls on the MongoDB pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openSuite());
  }, 180_000);

  afterAll(() => session?.close());

  const { activeChip, column } = pagesOn(() => ({ session, frame }));

  const openClusters = async () => {
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor(
      "the clusters",
      async () => (await countOf(session, frame, ROWS)) > 0 || undefined,
    );
  };

  describe("the Clusters list's chips", () => {
    it("starts on All, and every narrower chip lights alone and shows no more", async () => {
      await openClusters();
      await pressChip(session, frame, CHIPS, "All");

      const all = await countOf(session, frame, ROWS);
      const chips = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(CHIPS)})].map((each) => each.firstChild.textContent.trim())`,
        frame,
      );

      expect(chips.length).toBeGreaterThan(1);

      for (const chip of chips.slice(1)) {
        await pressChip(session, frame, CHIPS, chip);

        expect(await activeChip()).toBe(chip);
        // Compared with All, not a number: a number would be this cluster's contents.
        expect(
          await countOf(session, frame, ROWS),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
      }

      await pressChip(session, frame, CHIPS, "All");
      expect(await countOf(session, frame, ROWS)).toBe(all);
    }, 120_000);

    it("shows under a state's chip only the clusters in that state", async () => {
      await openClusters();

      for (const chip of ["Degraded", "Changing version"]) {
        await pressChip(session, frame, CHIPS, chip);

        const states = (await column("State")).map((each) => each.split(" · ")[0]);

        expect(states.length, `${chip} shows nothing`).toBeGreaterThan(0);
        expect(
          states.filter((each) => each !== chip),
          chip,
        ).toEqual([]);
      }

      await pressChip(session, frame, CHIPS, "All");
    }, 90_000);
  });

  describe("the Clusters list's search and rows", () => {
    it("narrows to a name that is on the list", async () => {
      await openClusters();
      await pressChip(session, frame, CHIPS, "All");

      const all = await countOf(session, frame, ROWS);

      await typeInto(session, frame, 'input[aria-label="Search Clusters"]', "catalog-rs");

      const shown = await waitFor("the list to narrow", async () => {
        const names = (await column("Cluster")).map((each) => each.split(" · ")[0]);

        return names.length < all ? names : undefined;
      });

      expect(shown).toEqual(["catalog-rs"]);
      await typeInto(session, frame, 'input[aria-label="Search Clusters"]', "");
    }, 60_000);

    it("links a member to the host's Pods list, narrowed to it, and closes the drawer", async () => {
      await openClusters();
      await session.evaluate(
        `[...document.querySelectorAll(${JSON.stringify(ROWS)})].find((row) => row.children[1]?.textContent.startsWith("catalog-rs"))?.querySelector("td:nth-child(2)").click()`,
        frame,
      );
      await waitFor("catalog-rs's drawer", async () =>
        (await drawerTitle(session, frame, DRAWER)) === "Cluster: catalog-rs" ? true : undefined,
      );

      const clicked = await session.evaluate<boolean>(
        `(() => {
          const link = [...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-link')].find((each) => /Pods list/.test(each.title) && each.textContent === "catalog-rs-0");
          link?.click();
          return Boolean(link);
        })()`,
        frame,
      );

      expect(clicked, "no Pods-list link on catalog-rs-0").toBe(true);

      const landed = await waitFor("the host's Pods list", async () => {
        const path = await session.evaluate<string>("location.pathname + location.search", frame);

        return path.includes("/pods") ? path : undefined;
      });

      expect(decodeURIComponent(landed)).toContain("search=catalog-rs-0");
      expect(await countOf(session, frame, `${DRAWER} [data-section="mongodb-members"]`)).toBe(0);
    }, 60_000);

    it("links a user's connection Secret to the host's Secrets list, by name only", async () => {
      await openClusters();
      await session.evaluate(
        `[...document.querySelectorAll(${JSON.stringify(ROWS)})].find((row) => row.children[1]?.textContent.startsWith("catalog-rs"))?.querySelector("td:nth-child(2)").click()`,
        frame,
      );
      await waitFor("catalog-rs's drawer", async () =>
        (await drawerTitle(session, frame, DRAWER)) === "Cluster: catalog-rs" ? true : undefined,
      );

      const secret = await session.evaluate<string>(
        `(() => {
          const link = [...document.querySelectorAll('${DRAWER} [data-section="mongodb-users"] .MongoDB-link')].find((each) => /Secrets list/.test(each.title));
          link?.click();
          return link?.textContent ?? "";
        })()`,
        frame,
      );

      expect(secret, "no Secrets-list link on catalog-rs's user").not.toBe("");

      const landed = await waitFor("the host's Secrets list", async () => {
        const path = await session.evaluate<string>("location.pathname + location.search", frame);

        return path.includes("/secrets") ? path : undefined;
      });

      expect(decodeURIComponent(landed)).toContain(`search=${secret}`);
      expect(await countOf(session, frame, `${DRAWER} [data-section="mongodb-users"]`)).toBe(0);
    }, 60_000);
  });

  it("does all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
