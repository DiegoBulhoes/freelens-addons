import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import { type ErrorLog, hoverForTooltip, openWorkbench } from "../../../../build/e2e/freelens";
import { closeDrawer as closeDrawerOf, openRow as openRowOf } from "../support/cert-manager";
import { DRAWER, drawerIcon } from "../support/lists";

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
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const openRow = (page: string, list: string, section: string, predicate?: string) =>
    openRowOf(session, frame, page, list, section, predicate);

  const closeDrawer = (section: string) => closeDrawerOf(session, frame, section);

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
        const present = drawerIcon(icon);

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

  it.each([
    [
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.querySelector('.CertManager-status')?.textContent.includes('Not ready')",
    ],
    [
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.querySelector('.CertManager-status')?.textContent.includes('Renewal failing')",
    ],
    [
      "cert-manager-issuers",
      "cert-manager-issuers",
      "cert-manager-issuer",
      "each.dataset.state === 'failed'",
    ],
    [
      "cert-manager-unmanaged",
      "served",
      "cert-manager-served",
      "each.dataset.state === 'unmanaged'",
    ],
  ])(
    "draws a failing row of %s in a drawer that keeps the standard",
    async (page, list, section, predicate) => {
      await openRow(page, list, section, predicate);

      expect(await designViolations(session, frame, "CertManager")).toEqual([]);
      await closeDrawer(section);
    },
    90_000,
  );

  it("opens every drawer without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
