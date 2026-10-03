import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  notificationSaying,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

// One `it`: a test per step would let the journey pass halfway.

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

    await click(`
      const button = [...document.querySelectorAll('.CertManager-link')]
        .find((each) => each.textContent.trim() === "All issuers");
      if (!button) return false;
      button.click();
      return true;
    `);

    // By pathname: the picker's query is carried along to a page that ignores it.
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

    await waitFor("the picker on it again", async () => {
      const headline = await textOf(
        session,
        frame,
        ".CertManager-picker__detail .CertManager-page__headline",
      );

      return headline === name ? headline : undefined;
    });

    // The details drawer cannot open from an extension page, so the list is narrowed to it.
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
