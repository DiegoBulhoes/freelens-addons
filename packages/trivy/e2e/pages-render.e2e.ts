import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  type ConsoleError,
  clickSidebar,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * Every page this extension registers, opened and read.
 *
 * What this catches is the gap `verify-bundles.sh` cannot reach. That script
 * asserts the shape of a bundle — a default export that is a class, no host
 * module bundled — and a bundle can satisfy all of it and still throw on mount,
 * render an empty state against a cluster that has data, or never appear in the
 * sidebar at all. Every one of those is silent: the page is simply blank.
 *
 * The rows are asserted as "more than none" rather than as a number. A count is
 * the development cluster's contents on the day it was written, and `make
 * cluster` will seed a different number the moment a manifest changes.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

interface PageCheck {
  /** The id this extension registered, which is also how the sidebar is driven. */
  id: string;
  /** Something the page renders only once it has its data. */
  expect: { selector: string; matches: RegExp };
}

const PAGES: PageCheck[] = [
  {
    id: "trivy-dashboard",
    expect: { selector: ".Trivy-page__headline", matches: /\d+ critical findings in \d+/ },
  },
  {
    id: "trivy-workloads",
    expect: { selector: ".Trivy-picker", matches: /\S/ },
  },
  {
    id: "trivy-vulnerabilities",
    expect: { selector: ".TrivyVulnerabilityReports", matches: /\S/ },
  },
  {
    id: "trivy-rbac",
    expect: { selector: ".Trivy-page__headline", matches: /\d+ critical grants across \d+/ },
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
    // One assertion over two pages rather than one each: what is being checked
    // is that the store behind our own picker is the store the host's list page
    // fills, which is a single property.
    const counted: Record<string, number> = {};

    for (const [id, selector] of [
      ["trivy-vulnerabilities", ".TableRow"],
      ["trivy-workloads", ".Trivy-picker__item"],
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
