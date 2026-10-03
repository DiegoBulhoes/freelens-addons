import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, openWorkbench, textOf, waitFor } from "../../../build/e2e/freelens";

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

  it("takes a pod row to the host's Pods list, narrowed to that pod", async () => {
    await clickSidebar(session, frame, "trivy-workloads", "trivy");

    // Pods of a workload can be gone, so walk until one has any.
    const podName = await waitFor(
      "a workload with a running pod",
      async () => {
        const rows = await countOf(".Trivy-picker__item");

        for (let index = 0; index < rows; index++) {
          await session.evaluate(
            `document.querySelectorAll('.Trivy-picker__item')[${index}]?.click()`,
            frame,
          );
          await new Promise((resolve) => setTimeout(resolve, 800));

          const name = await textOf(
            session,
            frame,
            ".Trivy-picker__detail button.Trivy-row .Trivy-truncate",
          );

          if (name.length > 0) return name;
        }

        return undefined;
      },
      90_000,
    );

    expect(await clickFirst(".Trivy-picker__detail button.Trivy-row")).toBe(true);

    const landed = await waitFor("the Pods list", async () => {
      const where = await location();

      return where.startsWith("/pods") ? where : undefined;
    });

    // The host reads ?search= on every list.
    expect(landed).toContain("search=");
    expect(decodeURIComponent(landed)).toContain(podName);
  }, 150_000);

  it("takes a vulnerability report to the workload it belongs to", async () => {
    await clickSidebar(session, frame, "trivy-vulnerabilities", "trivy");

    const reports = await waitFor("a report to click", async () => {
      const rows = await countOf(".TrivyVulnerabilityReports .TableRow");

      return rows > 0 ? rows : undefined;
    });

    expect(reports).toBeGreaterThan(0);

    expect(await clickFirst(".TrivyVulnerabilityReports .TableRow")).toBe(true);

    // Lens carries page params in the query string.
    const landed = await waitFor("the workloads page", async () => {
      const where = await location();

      return where.includes("/workloads?") ? where : undefined;
    });

    for (const param of ["namespace=", "kind=", "name="]) expect(landed).toContain(param);

    const selected = await waitFor("a workload to be selected", async () => {
      const name = await textOf(
        session,
        frame,
        ".Trivy-picker__item--selected .Trivy-picker__name",
      );

      return name.length > 0 ? name : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(selected);
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
