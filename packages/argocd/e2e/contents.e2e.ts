import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

// Counts are compared against the API via the host's proxy, so no cluster contents are written down.

const APPLICATIONS = "/apis/argoproj.io/v1alpha1/applications";
const PROJECTS = "/apis/argoproj.io/v1alpha1/appprojects";

interface ApplicationStatus {
  status?: {
    sync?: { status?: string };
    health?: { status?: string };
  };
  spec?: { syncPolicy?: { automated?: unknown } };
}

describe("the numbers the ArgoCD overview shows", () => {
  let session: Session;
  let frame: number;
  let applications: ApplicationStatus[];
  let projects: unknown[];

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());

    applications = await clusterItems<ApplicationStatus>(session, frame, APPLICATIONS);
    projects = await clusterItems(session, frame, PROJECTS);

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await waitFor("the overview", async () => (await cardCount()) > 0 || undefined);
  }, 180_000);

  afterAll(() => session?.close());

  function cardCount(): Promise<number> {
    return session.evaluate<number>("document.querySelectorAll('.ArgoCD-card').length", frame);
  }

  /** The number a card shows above its label, or -1 when there is no such card. */
  function cardValue(label: string): Promise<number> {
    return session.evaluate<number>(
      `(() => {
        const card = [...document.querySelectorAll('.ArgoCD-card')]
          .find((each) => each.querySelector('.ArgoCD-card__label')?.textContent.trim() === ${JSON.stringify(label)});
        if (!card) return -1;
        return Number.parseInt(card.querySelector('.ArgoCD-card__value').textContent, 10);
      })()`,
      frame,
    );
  }

  it("counts the Applications and Projects the cluster has", async () => {
    expect(await cardValue("Applications")).toBe(applications.length);
    expect(await cardValue("Projects")).toBe(projects.length);
  });

  it("counts each sync and health state as the cluster reports it", async () => {
    const withSync = (status: string) =>
      applications.filter((each) => each.status?.sync?.status === status).length;
    const withHealth = (status: string) =>
      applications.filter((each) => each.status?.health?.status === status).length;

    expect(await cardValue("Synced"), "Synced").toBe(withSync("Synced"));
    expect(await cardValue("OutOfSync"), "OutOfSync").toBe(withSync("OutOfSync"));
    expect(await cardValue("Healthy"), "Healthy").toBe(withHealth("Healthy"));
    expect(await cardValue("Progressing"), "Progressing").toBe(withHealth("Progressing"));

    // "Degraded" also counts Missing (`BROKEN_HEALTH` in overview.ts).
    expect(await cardValue("Degraded"), "Degraded, which is Degraded + Missing").toBe(
      withHealth("Degraded") + withHealth("Missing"),
    );
  });

  it("counts the ones nothing will sync on its own", async () => {
    const manual = applications.filter((each) => !each.spec?.syncPolicy?.automated).length;

    expect(await cardValue("No auto-sync")).toBe(manual);
  });

  it("says in its headline how many of them need attention", async () => {
    const headline = await textOf(session, frame, ".ArgoCD-page__headline");
    const rows = await session.evaluate<number>(
      `document.querySelectorAll('[data-section="attention"] .ArgoCD-row').length`,
      frame,
    );

    // "N of M": N must match the list below, M every Application.
    const match = /(\d+) of (\d+) Applications/.exec(headline);

    expect(match, `the headline does not count: ${headline}`).not.toBeNull();
    expect(Number(match?.[1]), "the headline's count is not what the list shows").toBe(rows);
    expect(Number(match?.[2]), "the headline's total is not the cluster's").toBe(
      applications.length,
    );
  });

  it("puts a pinned Application above the rest, whatever its severity", async () => {
    const names = () =>
      session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="attention"] .ArgoCD-row__name b')].map((each) => each.textContent.trim())`,
        frame,
      );

    const before = await names();

    expect(before.length, "one row cannot demonstrate an order").toBeGreaterThan(1);

    const last = before.at(-1);

    if (last === undefined) throw new Error("the attention list rendered no names");

    const menu = (name: string) =>
      session.evaluate<boolean>(
        `(() => {
          const row = [...document.querySelectorAll('[data-section="attention"] .ArgoCD-row')]
            .find((each) => each.textContent.includes(${JSON.stringify(name)}));
          const kebab = row?.querySelector('.ArgoCD-row__actions i.Icon');
          if (!kebab) return false;
          kebab.click();
          return true;
        })()`,
        frame,
      );

    const item = (label: string) =>
      session.evaluate<boolean>(
        `(() => {
          const entry = [...document.querySelectorAll('.MenuItem')]
            .find((each) => each.textContent.includes(${JSON.stringify(label)}));
          if (!entry) return false;
          entry.click();
          return true;
        })()`,
        frame,
      );

    expect(await menu(last)).toBe(true);
    expect(await item("Pin to the top")).toBe(true);

    const promoted = await waitFor(`${last} to reach the top`, async () => {
      const now = await names();

      return now[0] === last ? now : undefined;
    });

    expect(promoted[0]).toBe(last);

    // Unpin so the next run starts from the same state.
    expect(await menu(last)).toBe(true);
    expect(await item("Unpin")).toBe(true);

    await waitFor("the order to come back", async () => {
      const now = await names();

      return now[0] === before[0] ? now : undefined;
    });
  }, 150_000);
});
