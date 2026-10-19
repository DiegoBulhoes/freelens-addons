import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  type ErrorLog,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { controlsHelpers } from "../support/argocd";

// customizeHeader must return the whole header: a field left out drops the title, search and namespace selector.

const HEADER = ".ArgoCDApplications .header";

const PARTS = {
  title: `${HEADER} h5.title`,
  info: `${HEADER} .info-panel`,
  search: `${HEADER} .SearchInput input`,
  namespaces: `${HEADER} [data-testid="namespace-select-filter"] [class*="Select__control"]`,
};

const STATUS_CARDS = ["Synced", "OutOfSync", "Healthy", "Degraded", "Progressing", "No auto-sync"];

interface Shown {
  title: string;
  info: string;
  search: boolean;
  namespaces: boolean;
}

describe("the Applications page's header", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { openDashboard } = controlsHelpers(() => ({ session, frame }));

  const header = () =>
    session.evaluate<Shown>(
      `(() => {
        const visible = (selector) => {
          const element = document.querySelector(selector);
          return Boolean(element && element.getClientRects().length > 0 && element.offsetWidth > 0);
        };
        const text = (selector) => visible(selector) ? document.querySelector(selector).textContent.trim() : "";
        return {
          title: text(${JSON.stringify(PARTS.title)}),
          info: text(${JSON.stringify(PARTS.info)}),
          search: visible(${JSON.stringify(PARTS.search)}),
          namespaces: visible(${JSON.stringify(PARTS.namespaces)}),
        };
      })()`,
      frame,
    );

  const rows = () => countOf(session, frame, ".ArgoCDApplications .TableRow");

  it("shows the host's title, count, search and namespace selector", async () => {
    await clickSidebar(session, frame, "argocd-applications", "argocd");
    await waitFor("the Applications", async () => ((await rows()) > 1 ? true : undefined));

    const shown = await header();

    expect(shown.title).toBe("ArgoCD Applications");
    expect(shown.info).toMatch(/^\d+ items?$/);
    expect(shown.search, "no search box").toBe(true);
    expect(shown.namespaces, "no namespace selector").toBe(true);
  }, 90_000);

  it("counts N of M when filtered, and keeps the namespace selector", async () => {
    await openDashboard();

    const pressed = await session.evaluate<string>(
      `(() => {
        const cards = [...document.querySelectorAll("button.ArgoCD-card")].map((card) => ({
          card,
          label: card.querySelector(".ArgoCD-card__label")?.textContent.trim() ?? "",
          value: Number(card.querySelector(".ArgoCD-card__value")?.textContent ?? Number.NaN),
        }));
        const total = cards.find((each) => each.label === "Applications")?.value ?? 0;
        const narrower = cards.find((each) => ${JSON.stringify(STATUS_CARDS)}.includes(each.label) && each.value > 0 && each.value < total);
        narrower?.card.click();
        return narrower ? narrower.label + ":" + narrower.value + ":" + total : "";
      })()`,
      frame,
    );

    expect(pressed, "no status card narrower than every Application").not.toBe("");

    const [label, value, total] = pressed.split(":");

    const shown = await waitFor(`the list filtered to ${label}`, async () => {
      const now = await header();

      return now.info === `${value} of ${total}` ? now : undefined;
    });

    expect(shown.title).toMatch(/^ArgoCD Applications · /);
    expect(shown.search, "no search box").toBe(true);
    expect(shown.namespaces, "no namespace selector").toBe(true);
    expect(await rows()).toBe(Number(value));
  }, 90_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
