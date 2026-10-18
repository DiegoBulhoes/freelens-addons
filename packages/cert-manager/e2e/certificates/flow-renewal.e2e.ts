import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { COMMANDS, DRAWER } from "../support/lists";

// One `it`: a test per step would let the journey pass halfway.

describe("a failing renewal, from the overview to the Secret", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const where = () => session.evaluate<string>("location.pathname + location.search", frame);
  const click = async (script: string) => {
    expect(await session.evaluate<boolean>(`(() => { ${script} })()`, frame)).toBe(true);
  };

  it("finds it, explains it, and ends where it is served from", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor(
      "the attention list",
      async () =>
        (await countOf(session, frame, ".CertManager-list .CertManager-row")) > 0 || undefined,
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

    const landed = await waitFor("the certificates list on it", async () => {
      const path = await where();

      return path.includes(`name=${name}`) ? path : undefined;
    });

    expect(landed).toContain("/certificates");
    await waitFor("its drawer", async () =>
      (await drawerTitle(session, frame, DRAWER)) === `Certificate: ${name}` ? true : undefined,
    );
    expect(await textOf(session, frame, `${DRAWER} .CertManager-banner__title`)).toMatch(
      /renewal is failing/i,
    );

    const explains = await session.evaluate<{ kind: string; name: string }>(
      `(() => {
        const link = document.querySelector('${DRAWER} .CertManager-row[data-explains]');
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
      const rows = [...document.querySelectorAll('${COMMANDS} .CertManager-row')];
      const row = rows.find((each) => each.querySelector('.CertManager-row__reason')?.textContent.startsWith(${JSON.stringify(describe)}));
      if (!row) return false;
      row.querySelector('.CertManager-row__actions button').click();
      return true;
    `);

    const copied = `Describe the ${explains.kind} causing it copied.`;

    expect(await notificationSaying(session, frame, copied)).toContain(copied);

    await click(`
      const terms = [...document.querySelectorAll('${DRAWER} .CertManager-facts dt')];
      const link = terms.find((each) => each.textContent === "Issuer")?.nextElementSibling?.querySelector('.CertManager-link');
      if (!link) return false;
      link.click();
      return true;
    `);

    // By pathname: the route also names the issuer.
    await waitFor(
      "the issuers page",
      async () =>
        (await session.evaluate<boolean>("location.pathname.endsWith('/issuers')", frame)) ||
        undefined,
    );
    await waitFor(
      "the issuer's drawer",
      async () =>
        (await countOf(session, frame, `${DRAWER} [data-section="cert-manager-issuer"]`)) > 0 ||
        undefined,
    );

    await click(`
      const dependent = [...document.querySelectorAll('${DRAWER} [data-section="cert-manager-issuer-dependents"] .CertManager-row')]
        .find((each) => each.querySelector('b')?.textContent.trim() === ${JSON.stringify(name)});
      if (!dependent) return false;
      dependent.click();
      return true;
    `);

    await waitFor("its drawer again", async () =>
      (await drawerTitle(session, frame, DRAWER)) === `Certificate: ${name}` ? true : undefined,
    );

    // The details drawer cannot open from an extension page, so the list is narrowed to it.
    const secret = await session.evaluate<string>(
      `(() => {
        const terms = [...document.querySelectorAll('${DRAWER} .CertManager-facts dt')];
        return terms.find((each) => each.textContent === "Secret")?.nextElementSibling?.querySelector('.CertManager-link')?.textContent.trim() ?? "";
      })()`,
      frame,
    );

    expect(secret, "the certificate's Secret is not a link").not.toBe("");

    await click(`
      const terms = [...document.querySelectorAll('${DRAWER} .CertManager-facts dt')];
      const link = terms.find((each) => each.textContent === "Secret")?.nextElementSibling?.querySelector('.CertManager-link');
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

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
