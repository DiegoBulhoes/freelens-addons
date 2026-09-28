import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, openWorkbench, textOf, waitFor } from "../../../build/e2e/freelens";

/**
 * Where a click on a row actually lands.
 *
 * This is the one behaviour in either extension that is guaranteed to fail
 * silently. `Navigation.showDetails` merges a query parameter into the current
 * route, and the details drawer is rendered only by pages that mount it — the
 * host's own, and ours built on `KubeObjectListLayout`. Called from a plain
 * `clusterPage` it does nothing at all: no error, no navigation, a dead row. So
 * both extensions navigate to a host list narrowed by `?search=` instead, and
 * nothing until now checked that the navigation happens.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

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

    // The detail pane lists the pods of whichever workload is selected, and a
    // workload whose pods are gone is a normal thing to be looking at — so this
    // walks the list until it finds one that has any.
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

    // The whole point of the workaround: the host reads ?search= on every list
    // it renders, so the operator arrives with the pod already singled out.
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

    // The host's list, but the row leads to our workload page rather than to
    // the object's drawer: the report is the evidence, the workload the subject.
    expect(await clickFirst(".TrivyVulnerabilityReports .TableRow")).toBe(true);

    // Not the details drawer. The workloads page declares `params`, which Lens
    // carries in the query string rather than the path, so the subject travels
    // as namespace/kind/name and the link is one a person can keep.
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
});
