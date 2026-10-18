import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  countOf,
  drawerTitle,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  closeDrawer as closeDrawerOf,
  drawerOpen as drawerOpenOf,
  openRow as openRowOf,
  where as pageWhere,
} from "../support/cert-manager";
import { COMMANDS, DRAWER } from "../support/lists";

describe("opening a row of each cert-manager list", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const where = () => pageWhere(session, frame);

  const drawerOpen = (section: string) => drawerOpenOf(session, frame, section);

  const title = () => drawerTitle(session, frame, DRAWER);

  const openRow = (page: string, list: string, section: string, predicate?: string) =>
    openRowOf(session, frame, page, list, section, predicate);

  const closeDrawer = (section: string) => closeDrawerOf(session, frame, section);

  it("holds a certificate's validity, chain and commands, and copies each command", async () => {
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.textContent.includes(' left')",
    );

    for (const part of ["cert-manager-validity", "cert-manager-chain", "cert-manager-commands"]) {
      expect(await countOf(session, frame, `${DRAWER} [data-section="${part}"]`), part).toBe(1);
    }

    const labels = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${COMMANDS} .CertManager-row__name')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(labels.length).toBeGreaterThan(0);

    for (const [at, label] of labels.entries()) {
      await session.evaluate(
        `document.querySelectorAll('${COMMANDS} .CertManager-row__actions button')[${at}].click()`,
        frame,
      );

      expect(await notificationSaying(session, frame, `${label} copied.`)).toContain(label);
      expect(
        await countOf(session, frame, `${DRAWER} [data-section="cert-manager-certificate"]`),
        "copying closed the drawer",
      ).toBe(1);
    }

    await closeDrawer("cert-manager-certificate");
  }, 90_000);

  it("says when a certificate renews, from the spec cert-manager reads", async () => {
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.querySelector('.CertManager-status')?.textContent.includes('Renewal failing')",
    );

    const name = (await title()).replace(/^Certificate: /, "");
    const spec = (
      await clusterItems<{
        metadata: { name: string };
        spec: { duration?: string; renewBefore?: string };
      }>(session, frame, "/apis/cert-manager.io/v1/certificates")
    ).find((each) => each.metadata.name === name)?.spec;
    const lifetime = await session.evaluate<string>(
      `(() => {
        const terms = [...document.querySelectorAll('${DRAWER} .CertManager-facts dt')];
        return terms.find((each) => each.textContent === "Lifetime")?.nextElementSibling?.textContent ?? "";
      })()`,
      frame,
    );

    expect(spec?.renewBefore, `${name} has no renewBefore in the seed`).toBeDefined();
    expect(lifetime).toBe(`${spec?.duration}, renewing ${spec?.renewBefore} before the end`);
    await closeDrawer("cert-manager-certificate");
  }, 90_000);

  it("says why a renewal is not offered while cert-manager is already issuing", async () => {
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "/Not ready/.test(each.textContent)",
    );

    const fact = await session.evaluate<string>(
      `(() => {
        const terms = [...document.querySelectorAll('${DRAWER} .CertManager-facts dt')];
        return terms.find((each) => each.textContent === "Renew now")?.nextElementSibling?.textContent ?? "";
      })()`,
      frame,
    );

    expect(fact).toMatch(/already issuing/);
    await closeDrawer("cert-manager-certificate");
  }, 90_000);

  it("opens the certificate a route names, as the overview's rows do", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor("the attention rows", async () =>
      (await countOf(session, frame, ".CertManager-list .CertManager-row")) > 0 ? true : undefined,
    );

    const name = await session.evaluate<string>(
      `(() => {
        const row = document.querySelector('.CertManager-list .CertManager-row');
        row.click();
        return row.querySelector('b').textContent.trim();
      })()`,
      frame,
    );

    await waitFor("the route to name it", async () =>
      (await where()).includes(`name=${name}`) ? true : undefined,
    );
    await drawerOpen("cert-manager-certificate");

    expect(await title()).toBe(`Certificate: ${name}`);
    await closeDrawer("cert-manager-certificate");
  }, 90_000);

  it("opens a certificate's issuer, and from the issuer each certificate that depends on it", async () => {
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.querySelector('.CertManager-status--ok')",
    );

    const certificate = (await title()).replace(/^Certificate: /, "");
    const issuer = await session.evaluate<string>(
      `(() => {
        const terms = [...document.querySelectorAll('${DRAWER} .CertManager-facts dt')];
        const link = terms.find((each) => each.textContent === "Issuer")?.nextElementSibling?.querySelector('.CertManager-link');
        link?.click();
        return link?.textContent.trim() ?? "";
      })()`,
      frame,
    );

    expect(issuer, "the issuer is not a link").not.toBe("");
    await drawerOpen("cert-manager-issuer");
    expect(await title()).toBe(issuer.replace(" ", ": "));

    const opened = await session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll('${DRAWER} [data-section="cert-manager-issuer-dependents"] .CertManager-row')]
          .find((each) => each.querySelector('b')?.textContent.trim() === ${JSON.stringify(certificate)});
        row?.click();
        return Boolean(row);
      })()`,
      frame,
    );

    expect(opened, `${certificate} is not listed under its issuer`).toBe(true);
    await drawerOpen("cert-manager-certificate");
    expect(await title()).toBe(`Certificate: ${certificate}`);
    await closeDrawer("cert-manager-certificate");
  }, 120_000);

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
