import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations } from "../../../build/e2e/design";
import { clickSidebar, openWorkbench, textOf, waitFor } from "../../../build/e2e/freelens";
import { BODY, closeDrawer, drawerTitle, ROW } from "./workloads";

const DETAILS = ".TrivyVulnerabilityReportDetails";

describe("the drawers a link or a host list opens", () => {
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

  it("opens Workloads on the drawer of a workload waiting on a verdict", async () => {
    await clickSidebar(session, frame, "trivy-dashboard", "trivy");
    await waitFor("the overview", async () => (await countOf(".Trivy-card")) > 0 || undefined);

    const name = await session.evaluate<string>(
      `(() => {
        const section = [...document.querySelectorAll('.Trivy-section')]
          .find((each) => each.querySelector('.Trivy-section__title')?.textContent.trim() === "Waiting on a verdict");
        const row = section?.querySelector('button.Trivy-row');
        row?.click();
        return row?.querySelector('.Trivy-row__name b')?.textContent.trim() ?? '';
      })()`,
      frame,
    );

    // Only while a scan is pending; a fully scanned cluster lists none.
    if (name === "") return;

    const title = await waitFor("its drawer", async () => {
      const text = await drawerTitle(session, frame);

      return text.endsWith(`: ${name}`) ? text : undefined;
    });

    expect(title).toMatch(new RegExp(`: ${name}$`));
    expect(await countOf(ROW), "the list under the drawer").toBeGreaterThan(0);
    expect(await textOf(session, frame, BODY)).toMatch(/does not mean it is clean/);

    await closeDrawer(session, frame);
  }, 90_000);

  describe("a vulnerability report's host drawer", () => {
    beforeAll(async () => {
      await clickSidebar(session, frame, "trivy-vulnerabilities", "trivy");
      await waitFor(
        "the reports",
        async () => (await countOf(".TrivyVulnerabilityReports .TableRow")) > 0 || undefined,
      );
      await session.evaluate(
        "document.querySelector('.TrivyVulnerabilityReports .TableRow')?.click()",
        frame,
      );
      await waitFor(
        "the extension's details",
        async () => (await countOf(DETAILS)) > 0 || undefined,
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

    it("lists its worst findings that have a fix, and only those", async () => {
      const fixes = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${DETAILS} .Trivy-table tbody tr td:last-child`)})]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      expect(fixes.length).toBeLessThanOrEqual(10);
      for (const fix of fixes) expect(fix).not.toBe("none published");
    }, 60_000);

    it("is built from the design standard", async () => {
      expect(await designViolations(session, frame, "Trivy")).toEqual([]);
    }, 60_000);
  });
});
