import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  type ConsoleError,
  clickSidebar,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

// Counts are "more than none": a number would be the dev cluster's contents.

interface PageCheck {
  id: string;
  expect: { selector: string; matches: RegExp };
  rows: string;
}

const PAGES: PageCheck[] = [
  {
    id: "cert-manager-overview",
    expect: {
      selector: ".CertManager-page__headline",
      matches: /\d+ of \d+ certificates? needs? attention|certificates? (is|are) fine/,
    },
    rows: ".CertManager-card",
  },
  {
    id: "cert-manager-certificates",
    expect: { selector: ".CertManager-page__headline", matches: /^Certificates \d+ items?/ },
    rows: '[data-section="cert-manager-certificates"] tbody tr',
  },
  {
    id: "cert-manager-issuers",
    expect: { selector: ".CertManager-page__subline", matches: /issuers? (is|are)/ },
    rows: '[data-section="cert-manager-issuers"] tbody tr',
  },
  {
    id: "cert-manager-requests",
    expect: { selector: ".CertManagerRequests", matches: /\S/ },
    rows: ".TableRow",
  },
  {
    id: "cert-manager-unmanaged",
    expect: { selector: ".CertManager-page__headline", matches: /TLS Secret/ },
    rows: '[data-section="served"] tbody tr',
  },
];

describe("every page the cert-manager extension registers renders", () => {
  let session: Session;
  let frame: number;
  let errors: { drain: () => ConsoleError[] };

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  for (const page of PAGES) {
    it(`opens ${page.id}, with rows`, async () => {
      await clickSidebar(session, frame, page.id, "cert-manager");

      const text = await waitFor(`${page.id} to render`, async () => {
        const found = await textOf(session, frame, page.expect.selector);

        return found.length > 0 ? found : undefined;
      });

      expect(text).toMatch(page.expect.matches);

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
    }, 60_000);
  }

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
