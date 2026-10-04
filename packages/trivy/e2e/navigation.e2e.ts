import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, openWorkbench, textOf, waitFor } from "../../../build/e2e/freelens";
import { BODY, closeDrawer, column, drawerTitle, openRow, openWorkloads } from "./workloads";

describe("a row click goes somewhere", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const location = () => session.evaluate<string>("location.pathname + location.search", frame);

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const clickFirst = (selector: string) =>
    session.evaluate<boolean>(
      `(() => {
        const row = document.querySelector(${JSON.stringify(selector)});
        if (!row) return false;
        row.click();
        return true;
      })()`,
      frame,
    );

  it("takes a pod row in a workload's drawer to the host's Pods list, narrowed to that pod", async () => {
    const rows = await openWorkloads(session, frame);
    const coverage = await column(session, frame, "Coverage");
    const pods = `${BODY} [data-section="trivy-workload-pods"] button.Trivy-row`;

    // Pods of a workload can be gone, so walk until one has any.
    let podName = "";

    for (let index = 0; index < rows && podName === ""; index++) {
      if (coverage[index] !== "scanned") continue;

      await openRow(session, frame, index);
      await new Promise((resolve) => setTimeout(resolve, 800));
      podName = await textOf(session, frame, `${pods} .Trivy-truncate`);
    }

    expect(podName, "no workload has a running pod").not.toBe("");
    expect(await clickFirst(pods)).toBe(true);

    const landed = await waitFor("the Pods list", async () => {
      const where = await location();

      return where.startsWith("/pods") ? where : undefined;
    });

    // The host reads ?search= on every list.
    expect(landed).toContain("search=");
    expect(decodeURIComponent(landed)).toContain(podName);
    expect(await countOf(BODY), "the drawer stayed open over the Pods list").toBe(0);
  }, 150_000);

  it("takes a vulnerability report's drawer to its workload's drawer", async () => {
    await clickSidebar(session, frame, "trivy-vulnerabilities", "trivy");
    await waitFor(
      "a report to click",
      async () => (await countOf(".TrivyVulnerabilityReports .TableRow")) > 0 || undefined,
    );

    expect(await clickFirst(".TrivyVulnerabilityReports .TableRow")).toBe(true);

    const link = ".TrivyVulnerabilityReportDetails button.Trivy-link";
    const workload = await waitFor("the report's workload in the host's drawer", async () => {
      const text = await textOf(session, frame, link);

      return text.length > 0 ? text : undefined;
    });

    // The host's drawer, not a jump: the list stays where it was.
    expect(await location()).not.toContain("/workloads");

    expect(await clickFirst(link)).toBe(true);

    // Lens carries page params in the query string.
    const landed = await waitFor("the workloads page", async () => {
      const where = await location();

      return where.includes("/workloads?") ? where : undefined;
    });

    for (const param of ["namespace=", "kind=", "name="]) expect(landed).toContain(param);

    const [kind, name] = workload.split(" ");
    const title = await waitFor("the workload's drawer", async () => {
      const text = await drawerTitle(session, frame);

      return text === `${kind}: ${name}` ? text : undefined;
    });

    expect(title).toBe(`${kind}: ${name}`);
    expect(await countOf(".TrivyVulnerabilityReportDetails"), "the host's drawer stayed open").toBe(
      0,
    );
    await closeDrawer(session, frame);
  }, 150_000);

  it("takes a role in a check's drawer to the host's list of its kind, narrowed to it", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await waitFor(
      "a check to open",
      async () => (await countOf(".Trivy-table tbody tr")) > 0 || undefined,
    );

    expect(await clickFirst(".Trivy-table tbody tr")).toBe(true);

    const role = await waitFor("a role in the drawer", async () => {
      const found = await session.evaluate<{ name: string; kind: string } | null>(
        `(() => {
          const row = document.querySelector('.TrivyObjectDrawer .Trivy-table tbody tr');
          if (!row) return null;
          return {
            name: row.querySelector('.Trivy-link').textContent.trim(),
            kind: row.children[1].textContent.trim(),
          };
        })()`,
        frame,
      );

      return found ?? undefined;
    });

    expect(await clickFirst(".TrivyObjectDrawer .Trivy-table tbody tr .Trivy-link")).toBe(true);

    const list = role.kind === "ClusterRole" ? "/cluster-roles" : "/roles";
    const landed = await waitFor(`the ${list} list`, async () => {
      const where = await location();

      return where.startsWith(list) ? where : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(`search=${role.name}`);
  }, 150_000);
});
