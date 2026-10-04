import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  drawerTitle,
  hoverForTooltip,
  notificationSaying,
  openDrawer,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: the renewal is opened and cancelled at its confirmation.

const DRAWER = ".CertManagerObjectDrawer";

// [page, list section, drawer section, facts it must hold, title-bar icons]
const LISTS: [page: string, list: string, section: string, facts: string[], icons: string[]][] = [
  [
    "cert-manager-certificates",
    "cert-manager-certificates",
    "cert-manager-certificate",
    ["Namespace", "Issuer", "Names", "Secret", "Lifetime", "Renew now"],
    ["autorenew"],
  ],
  [
    "cert-manager-issuers",
    "cert-manager-issuers",
    "cert-manager-issuer",
    ["Kind", "Type", "State"],
    [],
  ],
  [
    "cert-manager-unmanaged",
    "served",
    "cert-manager-served",
    ["Namespace", "Hosts", "Secret", "Certificate", "Host list"],
    [],
  ],
  [
    "cert-manager-unmanaged",
    "secrets",
    "cert-manager-secret",
    ["Namespace", "Type", "Created", "Served by", "cert-manager annotations", "Host list"],
    [],
  ],
];

describe("opening a row of each cert-manager list", () => {
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

  const where = () =>
    session.evaluate<string>(
      "location.pathname.replace('/extension/freelens-addons--cert-manager', '') + location.search",
      frame,
    );

  const drawerOpen = (section: string) =>
    waitFor(`${section}'s drawer`, async () =>
      (await countOf(`${DRAWER} [data-section="${section}"]`)) > 0 ? true : undefined,
    );

  const title = () => drawerTitle(session, frame, DRAWER);

  const closeDrawer = (section: string) =>
    session
      .evaluate(
        `[...(${openDrawer(DRAWER)}?.querySelectorAll('.drawer-title i.Icon') ?? [])].find((each) => each.textContent.trim() === "close")?.click()`,
        frame,
      )
      .then(() =>
        waitFor("the drawer to close", async () =>
          (await countOf(`${DRAWER} [data-section="${section}"]`)) === 0 ? true : undefined,
        ),
      );

  /** Clicks a cell that is not the checkbox's, as a person opening the row would. */
  const openRow = async (page: string, list: string, section: string, predicate = "true") => {
    await clickSidebar(session, frame, page, "cert-manager");
    await waitFor(`${list}'s rows`, async () =>
      (await countOf(`[data-section="${list}"] tbody tr`)) > 0 ? true : undefined,
    );

    const name = await session.evaluate<string>(
      `(() => {
        const row = [...document.querySelectorAll('[data-section="${list}"] tbody tr')].find((each) => ${predicate});
        const cell = row?.querySelector('td:not(.CertManager-table__check)');
        cell?.click();
        return cell?.textContent.trim() ?? "";
      })()`,
      frame,
    );

    expect(name, `no row on ${list} matches ${predicate}`).not.toBe("");
    await drawerOpen(section);
  };

  it.each(LISTS)(
    "opens %s's %s rows in a drawer, with its facts and its actions in the title bar",
    async (page, list, section, facts, icons) => {
      await openRow(page, list, section);

      const terms = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="${section}"] .CertManager-facts dt')].map((each) => each.textContent)`,
        frame,
      );

      expect(terms).toEqual(expect.arrayContaining(facts));

      for (const icon of icons) {
        const present = `[...(${openDrawer(DRAWER)}?.querySelectorAll('.drawer-title i.Icon') ?? [])].find((each) => each.textContent.trim() === ${JSON.stringify(icon)})`;

        expect(await session.evaluate<boolean>(`Boolean(${present})`, frame), icon).toBe(true);
        await session.evaluate(`${present}.setAttribute("data-hovered", "")`, frame);
        expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`), icon).toMatch(
          /\w/,
        );
        await session.evaluate(
          `(() => {
            const icon = document.querySelector('${DRAWER} [data-hovered]');
            for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) icon?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
            icon?.removeAttribute("data-hovered");
          })()`,
          frame,
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      const buttons = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} .CertManager button')].filter((each) => !each.title).map((each) => each.textContent.trim())`,
        frame,
      );

      expect(buttons, "buttons in the drawer without a tooltip").toEqual([]);
      expect(await designViolations(session, frame, "CertManager")).toEqual([]);
      await closeDrawer(section);
    },
    90_000,
  );

  it("holds a certificate's validity, chain and commands, and copies each command", async () => {
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.textContent.includes(' left')",
    );

    for (const part of ["cert-manager-validity", "cert-manager-chain", "cert-manager-commands"]) {
      expect(await countOf(`${DRAWER} [data-section="${part}"]`), part).toBe(1);
    }

    const commands = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} .CertManager-command__text')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(commands.length).toBeGreaterThan(0);

    for (const [at, command] of commands.entries()) {
      await session.evaluate(
        `document.querySelectorAll('${DRAWER} .CertManager-command .CertManager-icon-button')[${at}].click()`,
        frame,
      );

      expect(await notificationSaying(session, frame, command)).toContain(command);
      expect(
        await countOf(`${DRAWER} [data-section="cert-manager-certificate"]`),
        "copying closed the drawer",
      ).toBe(1);
    }

    await closeDrawer("cert-manager-certificate");
  }, 90_000);

  it("asks before renewing from the title bar, and writes nothing when cancelled", async () => {
    // A healthy row nothing is issuing, so the renewal is offered.
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.querySelector('.CertManager-status--ok') && each.textContent.includes(' left')",
    );

    const name = (await title()).replace(/^Certificate: /, "");

    await session.evaluate(
      `[...(${openDrawer(DRAWER)}?.querySelectorAll('.drawer-title i.Icon') ?? [])].find((each) => each.textContent.trim() === "autorenew").click()`,
      frame,
    );

    const question = await waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text.includes(name) ? text : undefined;
    });

    expect(question).toMatch(/stays in use/);
    expect(
      await session.evaluate<number>(
        "document.querySelectorAll('.ConfirmDialog input').length",
        frame,
      ),
    ).toBe(0);
    expect(await dialogColourViolations(session, frame, "CertManager")).toEqual([]);
    expect(
      await countOf(`${DRAWER} [data-section="cert-manager-certificate"]`),
      "the menu item's click closed the drawer",
    ).toBe(1);

    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the confirmation to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
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
      (await countOf(".CertManager-list .CertManager-row")) > 0 ? true : undefined,
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

  it("leaves an unmanaged Ingress's drawer for the host's list, narrowed to it", async () => {
    await openRow("cert-manager-unmanaged", "served", "cert-manager-served");

    const ingress = (await title()).replace(/^Ingress: /, "");

    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .CertManager-link')].find((each) => each.textContent.endsWith("in the Ingresses list")).click()`,
      frame,
    );

    const landed = await waitFor("the host's Ingresses list", async () => {
      const path = await session.evaluate<string>("location.pathname + location.search", frame);

      return path.startsWith("/ingresses") ? path : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(`search=${ingress}`);
    expect(await countOf(`${DRAWER} [data-section="cert-manager-served"]`)).toBe(0);
  }, 90_000);

  it("says why a TLS Secret is unmanaged, and leaves for the host's Secrets list", async () => {
    await openRow("cert-manager-unmanaged", "secrets", "cert-manager-secret");

    const secret = (await title()).replace(/^Secret: /, "");
    const why = await textOf(
      session,
      frame,
      `${DRAWER} [data-section="cert-manager-secret"] > :is(.CertManager-muted, .CertManager-banner)`,
    );

    expect(why).toMatch(/No Certificate writes it|no longer exists/);

    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .CertManager-link')].find((each) => each.textContent.endsWith("in the Secrets list")).click()`,
      frame,
    );

    const landed = await waitFor("the host's Secrets list", async () => {
      const path = await session.evaluate<string>("location.pathname + location.search", frame);

      return path.startsWith("/secrets") ? path : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(`search=${secret}`);
  }, 90_000);
});
