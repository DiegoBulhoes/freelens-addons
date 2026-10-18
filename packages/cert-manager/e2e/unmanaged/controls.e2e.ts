import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  pressSort,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { closeDrawer as closeDrawerOf, where as pageWhere } from "../support/cert-manager";
import { DRAWER, SERVED_ROWS } from "../support/lists";

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

  const closeDrawer = () => closeDrawerOf(session, frame);

  describe("the unmanaged TLS page", () => {
    const openUnmanaged = async () => {
      await clickSidebar(session, frame, "cert-manager-unmanaged", "cert-manager");
      await waitFor(
        "the served table",
        async () => (await countOf(session, frame, SERVED_ROWS)) > 0 || undefined,
      );
    };

    it("narrows both tables from its search, says so when nothing matches, and comes back", async () => {
      await openUnmanaged();
      const all = await countOf(session, frame, SERVED_ROWS);
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
          (await countOf(session, frame, SERVED_ROWS)) === all ? all : undefined,
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
        pressSort(session, frame, '[data-section="served"] th .CertManager-sort', "Ingress");

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
      await closeDrawer();
    }, 90_000);

    it("follows a row's Secret link to the host's list without opening the row", async () => {
      await openUnmanaged();
      expect(
        await countOf(session, frame, `${DRAWER} [data-section]`),
        "a drawer was left open",
      ).toBe(0);

      // React handles clicks at its root, so a click it stopped never reaches the document.
      const { secret, reachedRow } = await session.evaluate<{
        secret: string;
        reachedRow: boolean;
      }>(
        `(() => {
          const link = [...document.querySelectorAll(${JSON.stringify(`${SERVED_ROWS} td:nth-child(4) .CertManager-link`)})][0];
          let reachedRow = false;
          const seen = (event) => { if (event.target === link) reachedRow = true; };
          document.addEventListener("click", seen);
          link?.click();
          document.removeEventListener("click", seen);
          return { secret: link?.textContent.trim() ?? "", reachedRow };
        })()`,
        frame,
      );

      expect(secret, "no served row links its Secret").not.toBe("");
      expect(reachedRow, "the link's click went on to the row").toBe(false);

      const landed = await waitFor("the host's Secrets list", async () => {
        const path = await session.evaluate<string>("location.pathname + location.search", frame);

        return path.startsWith("/secrets") ? path : undefined;
      });

      expect(decodeURIComponent(landed)).toContain(`search=${secret}`);
      expect(await countOf(session, frame, `${DRAWER} [data-section="cert-manager-served"]`)).toBe(
        0,
      );
    }, 90_000);

    it("follows a served row's Certificate link to that certificate's drawer", async () => {
      await openUnmanaged();

      const { certificate, reachedRow } = await session.evaluate<{
        certificate: string;
        reachedRow: boolean;
      }>(
        `(() => {
          const link = [...document.querySelectorAll(${JSON.stringify(`${SERVED_ROWS} td:nth-child(5) .CertManager-link`)})]
            .find((each) => each.textContent.trim() === "managed-tls");
          let reachedRow = false;
          const seen = (event) => { if (event.target === link) reachedRow = true; };
          document.addEventListener("click", seen);
          link?.click();
          document.removeEventListener("click", seen);
          return { certificate: link?.textContent.trim() ?? "", reachedRow };
        })()`,
        frame,
      );

      expect(certificate, "no served row links the seed's managed-tls").toBe("managed-tls");
      expect(reachedRow, "the link's click went on to the row").toBe(false);
      expect(
        await waitFor("its drawer on the certificates list", async () => {
          const title = await drawerTitle(session, frame, DRAWER);

          return title === "Certificate: managed-tls" ? title : undefined;
        }),
      ).toBe("Certificate: managed-tls");
      expect(await where()).toContain("/certificates");
      expect(await where()).toContain("name=managed-tls");
      expect(await countOf(session, frame, `${DRAWER} [data-section="cert-manager-served"]`)).toBe(
        0,
      );
      await closeDrawer();
    }, 90_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
