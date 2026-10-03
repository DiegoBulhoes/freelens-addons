import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  type ConsoleError,
  clickSidebar,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

interface PageCheck {
  id: string;
  /** Something the page renders only once it has its data. */
  expect: { selector: string; matches: RegExp };
}

const PAGES: PageCheck[] = [
  {
    id: "argocd-dashboard",
    // A scope with no Applications reads "in sync" instead of a count.
    expect: { selector: ".ArgoCD-page__headline", matches: /\d+ of \d+ Applications|in sync/i },
  },
  {
    id: "argocd-applications",
    expect: { selector: ".ArgoCDApplications", matches: /\S/ },
  },
  {
    id: "argocd-projects",
    expect: { selector: ".ArgoCDAppProjects", matches: /\S/ },
  },
  {
    id: "image-updater-overview",
    expect: { selector: ".ArgoCD-page__headline", matches: /Image Updater rules/ },
  },
  {
    id: "image-updater-rules",
    expect: { selector: ".ArgoCD-page__headline", matches: /^Image Updater rules \d+ items?$/ },
  },
  {
    id: "image-updater-images",
    expect: { selector: ".ArgoCD-page__headline", matches: /^Watched images \d+ items?$/ },
  },
  {
    id: "image-updater-updates",
    expect: { selector: ".ArgoCD-page__headline", matches: /^Last updates \d+ items?$/ },
  },
];

/** Image Updater's screens sit one sidebar level deeper. */
const groupsOf = (id: string) =>
  id.startsWith("image-updater-") ? ["argocd", "argocd-image-updater"] : "argocd";

describe("every page the ArgoCD extension registers renders", () => {
  let session: Session;
  let frame: number;
  let errors: { drain: () => ConsoleError[] };

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  for (const page of PAGES) {
    it(`opens ${page.id}`, async () => {
      await clickSidebar(session, frame, page.id, groupsOf(page.id));

      const text = await waitFor(`${page.id} to render`, async () => {
        const found = await textOf(session, frame, page.expect.selector);

        return found.length > 0 ? found : undefined;
      });

      expect(text).toMatch(page.expect.matches);
    }, 60_000);
  }

  it("lists the Applications and Projects the cluster has", async () => {
    const counted: Record<string, number> = {};

    for (const id of ["argocd-applications", "argocd-projects"] as const) {
      await clickSidebar(session, frame, id, "argocd");

      counted[id] = await waitFor(`rows on ${id}`, async () => {
        const rows = await session.evaluate<number>(
          "document.querySelectorAll('.TableRow').length",
          frame,
        );

        return rows > 0 ? rows : undefined;
      });
    }

    for (const [id, rows] of Object.entries(counted)) {
      expect(rows, `${id} listed nothing`).toBeGreaterThan(0);
    }
  }, 120_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
