import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  notificationSaying,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * The task the extension exists for, done the way a person does it.
 *
 * A renewal is failing on a certificate that still reads as fine everywhere
 * else. From the overview: find it, open it, read which object explains it,
 * copy the command that describes that object, go to it, see what else depends
 * on it, come back, and end on the Secret in the host's own list. Every step is
 * a different page or a different kind of link, and each one has broken
 * somewhere before — a row that navigates nowhere, a drawer that cannot open
 * from here, a selection that does not survive a round trip.
 *
 * One `it`, because a test per step would let the journey pass halfway.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

describe("a failing renewal, from the overview to the Secret", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const where = () => session.evaluate<string>("location.pathname + location.search", frame);
  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );
  const click = async (script: string) => {
    expect(await session.evaluate<boolean>(`(() => { ${script} })()`, frame)).toBe(true);
  };

  it("finds it, explains it, and ends where it is served from", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor(
      "the attention list",
      async () => (await countOf(".CertManager-list .CertManager-row")) > 0 || undefined,
    );

    // 1. The row the list calls a failing renewal. It reads as fine anywhere else.
    const name = await session.evaluate<string>(
      `[...document.querySelectorAll('.CertManager-list .CertManager-row')]
         .find((row) => row.querySelector('.CertManager-row__state')?.textContent.trim() === "Renewal failing")
         ?.querySelector('b')?.textContent.trim() ?? ""`,
      frame,
    );

    expect(name, "no renewal is failing on this cluster").not.toBe("");
    console.log(`  starting from ${name}`);

    await click(`
      const row = [...document.querySelectorAll('.CertManager-list .CertManager-row')]
        .find((each) => each.querySelector('b')?.textContent.trim() === ${JSON.stringify(name)});
      if (!row) return false;
      row.click();
      return true;
    `);

    // 2. The picker, on that certificate, saying what is wrong.
    const landed = await waitFor("the picker on it", async () => {
      const path = await where();

      return path.includes(`name=${name}`) ? path : undefined;
    });

    expect(landed).toContain("/certificates");
    expect(
      await textOf(session, frame, ".CertManager-picker__detail .CertManager-page__headline"),
    ).toBe(name);
    expect(await textOf(session, frame, ".CertManager-banner__title")).toMatch(
      /renewal is failing/i,
    );

    // 3. The link that explains it, and the command that describes it.
    const explains = await session.evaluate<{ kind: string; name: string }>(
      `(() => {
        const link = document.querySelector('.CertManager-row[data-explains]');
        return {
          kind: link?.querySelector('.CertManager-row__name b')?.textContent.trim() ?? "",
          name: link?.querySelector('.CertManager-row__name code')?.textContent.trim() ?? "",
        };
      })()`,
      frame,
    );

    expect(explains.kind, "nothing in the chain explains it").not.toBe("");
    console.log(`  explained by ${explains.kind} ${explains.name}`);

    const describe = `kubectl describe ${explains.kind.toLowerCase()} ${explains.name}`;

    await click(`
      const texts = [...document.querySelectorAll('.CertManager-command__text')];
      const at = texts.findIndex((each) => each.textContent.startsWith(${JSON.stringify(describe)}));
      if (at < 0) return false;
      document.querySelectorAll('.CertManager-command .CertManager-icon-button')[at].click();
      return true;
    `);

    expect(await notificationSaying(session, frame, describe)).toContain(describe);

    // 4. Its issuers, where the same certificate is listed as depending on it.
    await click(`
      const button = [...document.querySelectorAll('.CertManager-link')]
        .find((each) => each.textContent.trim() === "All issuers");
      if (!button) return false;
      button.click();
      return true;
    `);

    // By pathname: arriving on the picker with namespace and name in the query,
    // the navigation carries that query along to a page that ignores it.
    await waitFor(
      "the issuers page",
      async () =>
        (await session.evaluate<boolean>("location.pathname.endsWith('/issuers')", frame)) ||
        undefined,
    );

    await click(`
      const dependent = [...document.querySelectorAll('.CertManager-box .CertManager-chip')]
        .find((each) => each.firstElementChild?.textContent.trim() === ${JSON.stringify(name)});
      if (!dependent) return false;
      dependent.click();
      return true;
    `);

    // 5. Back to it, by way of what it depends on.
    await waitFor("the picker on it again", async () => {
      const headline = await textOf(
        session,
        frame,
        ".CertManager-picker__detail .CertManager-page__headline",
      );

      return headline === name ? headline : undefined;
    });

    // 6. And to the Secret it writes, in the host's own list — the details drawer
    //    cannot be opened from an extension page, so the list is narrowed to it.
    const secret = await session.evaluate<string>(
      `[...document.querySelectorAll('.CertManager-facts dd .CertManager-link')][0]?.textContent.trim() ?? ""`,
      frame,
    );

    expect(secret, "the certificate's Secret is not a link").not.toBe("");

    await click(`
      const link = document.querySelector('.CertManager-facts dd .CertManager-link');
      if (!link) return false;
      link.click();
      return true;
    `);

    const secrets = await waitFor("the host's Secrets list", async () => {
      const path = await where();

      return path.startsWith("/secrets") ? path : undefined;
    });

    expect(decodeURIComponent(secrets)).toContain(`search=${secret}`);
  }, 240_000);
});
