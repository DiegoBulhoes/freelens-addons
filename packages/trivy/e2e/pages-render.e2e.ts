import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  type ConsoleError,
  clickSidebar,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";
import { ROW } from "./workloads";

interface PageCheck {
  id: string;
  expect: { selector: string; matches: RegExp };
}

const PAGES: PageCheck[] = [
  {
    id: "trivy-dashboard",
    expect: { selector: ".Trivy-page__headline", matches: /\d+ critical findings? in \d+/ },
  },
  {
    id: "trivy-workloads",
    expect: { selector: ".Trivy-page--list .Trivy-page__count", matches: /\d+ items?/ },
  },
  {
    id: "trivy-vulnerabilities",
    expect: { selector: ".TrivyVulnerabilityReports", matches: /\S/ },
  },
  {
    id: "trivy-rbac",
    expect: { selector: ".Trivy-page__subline", matches: /\d+ critical grants? across \d+/ },
  },
];

describe("every page the Trivy extension registers renders", () => {
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
      await clickSidebar(session, frame, page.id, "trivy");

      const text = await waitFor(`${page.id} to render`, async () => {
        const found = await textOf(session, frame, page.expect.selector);

        return found.length > 0 ? found : undefined;
      });

      expect(text).toMatch(page.expect.matches);
    }, 60_000);
  }

  it("lists the reports the cluster has", async () => {
    const counted: Record<string, number> = {};

    for (const [id, selector] of [
      ["trivy-vulnerabilities", ".TableRow"],
      ["trivy-workloads", ROW],
      ["trivy-rbac", ".Trivy-table tbody tr"],
    ] as const) {
      await clickSidebar(session, frame, id, "trivy");

      counted[id] = await waitFor(`rows on ${id}`, async () => {
        const rows = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(selector)}).length`,
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
