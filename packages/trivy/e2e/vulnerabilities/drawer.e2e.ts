import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { clickFirst, location } from "../support/trivy";
import { closeDrawer, drawerTitle } from "../support/workloads";

const DETAILS = ".TrivyVulnerabilityReportDetails";

describe("the drawers a link or a host list opens", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  describe("a vulnerability report's host drawer", () => {
    beforeAll(async () => {
      await clickSidebar(session, frame, "trivy-vulnerabilities", "trivy");
      await waitFor(
        "the reports",
        async () =>
          (await countOf(session, frame, ".TrivyVulnerabilityReports .TableRow")) > 0 || undefined,
      );
      await session.evaluate(
        "document.querySelector('.TrivyVulnerabilityReports .TableRow')?.click()",
        frame,
      );
      await waitFor(
        "the extension's details",
        async () => (await countOf(session, frame, DETAILS)) > 0 || undefined,
      );
    }, 90_000);

    it("names the workload, the image, the scanner and when, and counts by severity", async () => {
      const items = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${DETAILS} .DrawerItem .name`)})].map((each) => each.textContent.trim())`,
        frame,
      );

      expect(items).toEqual([
        "Workload",
        "Container",
        "Image",
        "Registry",
        "Base",
        "Scanner",
        "Last update",
        "Findings",
        "Fix published",
      ]);
      expect(await textOf(session, frame, `${DETAILS} button.Trivy-link`)).toMatch(/^\S+ \S+$/);
    }, 60_000);

    it("lists its worst findings that have a fix, as many as its Fix published counts", async () => {
      const fact = await session.evaluate<string>(
        `[...document.querySelectorAll(${JSON.stringify(`${DETAILS} .DrawerItem`)})]
           .find((each) => each.querySelector('.name')?.textContent.trim() === "Fix published")
           ?.querySelector('.value')?.textContent.trim() ?? ''`,
        frame,
      );
      const match = /^(\d+) of (\d+)$/.exec(fact);

      expect(match, `Fix published reads ${fact}`).not.toBeNull();

      const fixable = Number(match?.[1]);
      const fixes = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${DETAILS} .Trivy-table tbody tr td:last-child`)})]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      expect(fixable).toBeLessThanOrEqual(Number(match?.[2]));
      expect(fixes).toHaveLength(Math.min(fixable, 10));
      for (const fix of fixes) expect(fix).not.toBe("none published");

      const note = await textOf(session, frame, `${DETAILS} > .Trivy-section__note`);

      if (fixable > 10) expect(note).toContain(`groups all ${fixable} by the package upgrade`);
      else expect(note).toBe(fixable === 0 ? "No finding in this report has a published fix." : "");
    }, 60_000);

    it("is built from the design standard", async () => {
      expect(await designViolations(session, frame, "Trivy")).toEqual([]);
    }, 60_000);
  });

  // Last, so it covers every drawer and control above.
  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});

describe("a row click goes somewhere", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  it("takes a vulnerability report's drawer to its workload's drawer", async () => {
    await clickSidebar(session, frame, "trivy-vulnerabilities", "trivy");
    await waitFor(
      "a report to click",
      async () =>
        (await countOf(session, frame, ".TrivyVulnerabilityReports .TableRow")) > 0 || undefined,
    );

    expect(await clickFirst(session, frame, ".TrivyVulnerabilityReports .TableRow")).toBe(true);

    const link = ".TrivyVulnerabilityReportDetails button.Trivy-link";
    const workload = await waitFor("the report's workload in the host's drawer", async () => {
      const text = await textOf(session, frame, link);

      return text.length > 0 ? text : undefined;
    });

    // The host's drawer, not a jump: the list stays where it was.
    expect(await location(session, frame)).not.toContain("/workloads");

    expect(await clickFirst(session, frame, link)).toBe(true);

    // Lens carries page params in the query string.
    const landed = await waitFor("the workloads page", async () => {
      const where = await location(session, frame);

      return where.includes("/workloads?") ? where : undefined;
    });

    for (const param of ["namespace=", "kind=", "name="]) expect(landed).toContain(param);

    const [kind, name] = workload.split(" ");
    const title = await waitFor("the workload's drawer", async () => {
      const text = await drawerTitle(session, frame);

      return text === `${kind}: ${name}` ? text : undefined;
    });

    expect(title).toBe(`${kind}: ${name}`);
    expect(
      await countOf(session, frame, ".TrivyVulnerabilityReportDetails"),
      "the host's drawer stayed open",
    ).toBe(0);
    await closeDrawer(session, frame);
  }, 150_000);
});
