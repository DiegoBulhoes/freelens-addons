import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  type ErrorLog,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  pinnedNames,
  pressRowMenu,
  showAllAttention,
  unpin,
  unpinQuietly,
} from "../support/attention";

// Counts are compared against the API via the host's proxy, so no cluster contents are written down.

const APPLICATIONS = "/apis/argoproj.io/v1alpha1/applications";
const PROJECTS = "/apis/argoproj.io/v1alpha1/appprojects";

const SEARCH = '[data-section="attention"] .ArgoCD-search';
// As dashboard-page.tsx pages the attention list.
const PAGE_SIZE = 8;

interface ApplicationStatus {
  metadata: { name: string };
  status?: {
    sync?: { status?: string };
    health?: { status?: string };
    conditions?: { type?: string }[];
    history?: { deployedAt?: string; revision?: string; revisions?: string[] }[];
  };
  spec?: { syncPolicy?: { automated?: unknown } };
}

describe("the numbers the ArgoCD overview shows", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let applications: ApplicationStatus[];
  let projects: unknown[];

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();

    applications = await clusterItems<ApplicationStatus>(session, frame, APPLICATIONS);
    projects = await clusterItems(session, frame, PROJECTS);

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await waitFor("the overview", async () => (await cardCount()) > 0 || undefined);
  }, 180_000);

  afterAll(() => session?.close());

  const rowNames = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll('[data-section="attention"] .ArgoCD-row__name b')].map((each) => each.textContent.trim())`,
      frame,
    );

  /** The number on a chip of the attention list. */
  const chipCount = (label: string) =>
    session.evaluate<number>(
      `(() => {
        const chip = [...document.querySelectorAll('[data-section="attention"] .ArgoCD-filter')]
          .find((each) => each.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)});
        return Number(chip?.querySelector('.ArgoCD-filter__count')?.textContent ?? Number.NaN);
      })()`,
      frame,
    );

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

  it("says in its headline how many need attention, whatever the list is narrowed to", async () => {
    const headline = () => textOf(session, frame, ".ArgoCD-page__headline");
    const all = await showAllAttention(session, frame);
    const needing = await chipCount("All");

    // "N of M": N is the All chip's count, M every Application.
    const match = /(\d+) of (\d+) Applications/.exec(await headline());

    expect(match, `the headline does not count: ${await headline()}`).not.toBeNull();
    expect(Number(match?.[1]), "the headline's count is not the All chip's").toBe(needing);
    expect(Number(match?.[2]), "the headline's total is not the cluster's").toBe(
      applications.length,
    );
    expect(all).toBe(Math.min(needing, PAGE_SIZE));

    try {
      await typeInto(session, frame, SEARCH, "no-such-application-anywhere");
      await waitFor("the search to empty the list", async () =>
        (await rowNames()).length === 0 ? true : undefined,
      );
      expect(/(\d+) of/.exec(await headline())?.[1], "a search changed the headline").toBe(
        match?.[1],
      );
    } finally {
      await typeInto(session, frame, SEARCH, "");
    }
  });

  it("lists every Application the cluster reports a comparison or sync error on", async () => {
    const failing = applications
      .filter((each) =>
        (each.status?.conditions ?? []).some(
          (condition) => condition.type === "ComparisonError" || condition.type === "SyncError",
        ),
      )
      .map((each) => each.metadata.name);

    expect(failing.length, "no Application with a ComparisonError or SyncError").toBeGreaterThan(0);
    await showAllAttention(session, frame);

    try {
      // Searched one by one: the list shows a page at a time.
      for (const name of failing) {
        await typeInto(session, frame, SEARCH, name);
        await waitFor(`${name} on the attention list`, async () =>
          (await rowNames()).includes(name) ? true : undefined,
        );
      }
    } finally {
      await typeInto(session, frame, SEARCH, "");
    }
  });

  it("opens Recent rollouts on the newest deploy the cluster recorded", async () => {
    const isGit = (revision: string) => /^[0-9a-f]{7,40}$/.test(revision);
    const shown = (revision: string) =>
      /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;
    const deploys = applications.flatMap((each) =>
      (each.status?.history ?? []).map((deploy) => {
        const revisions = deploy.revisions ?? (deploy.revision ? [deploy.revision] : []);

        return {
          name: each.metadata.name,
          at: Date.parse(deploy.deployedAt ?? ""),
          revision: shown(revisions.find(isGit) ?? revisions[0] ?? "—"),
        };
      }),
    );
    const newestAt = Math.max(...deploys.map((deploy) => deploy.at).filter(Number.isFinite));
    const newest = deploys.filter((deploy) => deploy.at === newestAt);

    expect(newest.length, "no Application has recorded a deploy").toBeGreaterThan(0);

    const first = await waitFor("the first rollout", async () => {
      const row = await session.evaluate<{ revision: string; text: string } | null>(
        `(() => {
          const row = document.querySelector('[data-section="recent-rollouts"] tbody tr');
          if (!row) return null;
          return { revision: row.children[1].textContent.trim(), text: row.children[2].textContent };
        })()`,
        frame,
      );

      return row ?? undefined;
    });

    expect(newest.map((deploy) => deploy.revision)).toContain(first.revision);
    expect(
      newest.some((deploy) => first.text.includes(deploy.name)) || /\+\d+/.test(first.text),
      `the first rollout names none of ${newest.map((deploy) => deploy.name).join(", ")}`,
    ).toBe(true);
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

    expect(
      (await pinnedNames(session, frame)).includes(last),
      `${last} is pinned already, so it cannot be promoted`,
    ).toBe(false);

    try {
      expect(await pressRowMenu(session, frame, last, "Pin to the top")).toBe(true);

      const promoted = await waitFor(`${last} to reach the top`, async () => {
        const now = await names();

        return now[0] === last ? now : undefined;
      });

      expect(promoted[0]).toBe(last);

      await unpin(session, frame, last);
      await waitFor("the order to come back", async () => {
        const now = await names();

        return now[0] === before[0] ? now : undefined;
      });
    } finally {
      // So the next run starts from the same state, whichever step failed.
      await unpinQuietly(session, frame, last);
    }
  }, 150_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
