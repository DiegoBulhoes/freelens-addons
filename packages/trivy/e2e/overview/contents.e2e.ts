import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clusterItems,
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { BODY, closeDrawer, column, drawerTitle, openWorkloads, ROW } from "../support/workloads";

const VULNERABILITY_REPORTS = "/apis/aquasecurity.github.io/v1alpha1/vulnerabilityreports";
const SBOM_REPORTS = "/apis/aquasecurity.github.io/v1alpha1/sbomreports";
const CONFIG_AUDIT_REPORTS = "/apis/aquasecurity.github.io/v1alpha1/configauditreports";

describe("what the Trivy pages say", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const cardValue = (label: string) =>
    session.evaluate<number>(
      `(() => {
        const card = [...document.querySelectorAll('.Trivy-card')]
          .find((each) => each.querySelector('.Trivy-card__label')?.textContent.trim().startsWith(${JSON.stringify(label)}));
        if (!card) return -1;
        return Number.parseInt(card.querySelector('.Trivy-card__value').textContent, 10);
      })()`,
      frame,
    );

  it("knows as many workloads as the list shows, and no more than there are reports", async () => {
    type Report = { metadata: { labels?: Record<string, string> } };
    const subjects = (items: Report[]) =>
      new Set(
        items.map(({ metadata }) =>
          ["namespace", "kind", "name"]
            .map((part) => metadata.labels?.[`trivy-operator.resource.${part}`] ?? "")
            .join("/"),
        ),
      );
    const judged = subjects(await clusterItems<Report>(session, frame, VULNERABILITY_REPORTS));
    const reported = new Set([
      ...judged,
      ...subjects(await clusterItems<Report>(session, frame, SBOM_REPORTS)),
      ...subjects(await clusterItems<Report>(session, frame, CONFIG_AUDIT_REPORTS)),
    ]);

    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const known = await waitFor("the workloads card", async () => {
      const value = await cardValue("Workloads known");

      return value >= 0 ? value : undefined;
    });

    const listed = await openWorkloads(session, frame);

    expect(listed, "the list shows a different number than the overview counts").toBe(known);
    expect(await countOf(session, frame, ROW)).toBe(known);

    // Bounds, not equality: they hold however far the scanner has got.
    expect(known, "a judged workload is missing").toBeGreaterThanOrEqual(judged.size);
    expect(known, "a workload no report names").toBeLessThanOrEqual(reported.size);
  }, 150_000);

  // The seed's unscannable never gets a verdict, so the scan is never complete.
  it("says on the overview how far the scan has got, out of the workloads the list holds", async () => {
    await openWorkloads(session, frame);

    const states = await column(session, frame, "Coverage");
    const total = states.filter((state) => state !== "Scaled away").length;
    const judged = states.filter((state) => state === "Scanned").length;

    expect(judged, "every workload has a verdict").toBeLessThan(total);

    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const banner = await waitFor("the scan progress", async () => {
      const text = await textOf(
        session,
        frame,
        ".Trivy-page > .Trivy-banner:not([data-section]) > .Trivy-banner__title",
      );

      return text.length > 0 ? text : undefined;
    });
    const scanning = /^Scanning: (\d+) of (\d+) judged/.exec(banner);
    const stalled = /^Stalled: (\d+) of (\d+) workloads have no verdict/.exec(banner);

    expect(scanning ?? stalled, `the banner reads ${banner}`).not.toBeNull();
    if (scanning) expect([Number(scanning[1]), Number(scanning[2])]).toEqual([judged, total]);
    if (stalled) expect([Number(stalled[1]), Number(stalled[2])]).toEqual([total - judged, total]);
    // Only a stalled scan offers the commands that look at the operator.
    expect((await countOf(session, frame, '[data-section="trivy-scan-commands"] code')) > 0).toBe(
      stalled !== null,
    );
  }, 150_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});

describe("the drawers a link or a host list opens", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  // settle.sh waits for unscannable's config audit; its image does not exist, so it is never scanned.
  it("opens Workloads on the drawer of a workload waiting on a verdict", async () => {
    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const waiting = await waitFor("the workloads waiting on a verdict", async () => {
      const rows = await session.evaluate<{ name: string; state: string }[]>(
        `[...document.querySelectorAll('.Trivy-section')]
           .filter((each) => each.querySelector('.Trivy-section__title')?.textContent.trim() === "Waiting on a verdict")
           .flatMap((each) => [...each.querySelectorAll('button.Trivy-row')])
           .map((row) => ({
             name: row.querySelector('.Trivy-row__name b')?.textContent.trim() ?? '',
             state: row.querySelector('.Trivy-row__state')?.textContent.trim() ?? '',
           }))`,
        frame,
      );

      return rows.length > 0 ? rows : undefined;
    });
    const unscannable = waiting.find((row) => row.name.startsWith("unscannable-"));

    expect(unscannable, "the seed's unscannable is not waiting on a verdict").toBeDefined();
    expect(unscannable?.state).toBe("Not looked at");
    // Worst first, so one the operator never looked at leads.
    expect(waiting[0]?.state).toBe("Not looked at");

    const name = unscannable?.name ?? "";

    await session.evaluate(
      `[...document.querySelectorAll('.Trivy-section button.Trivy-row')]
         .find((row) => row.querySelector('.Trivy-row__name b')?.textContent.trim() === ${JSON.stringify(name)})
         ?.click()`,
      frame,
    );

    const title = await waitFor("its drawer", async () => {
      const text = await drawerTitle(session, frame);

      return text.endsWith(`: ${name}`) && (await countOf(session, frame, BODY)) > 0
        ? text
        : undefined;
    });

    expect(title).toBe(`ReplicaSet: ${name}`);
    expect(await countOf(session, frame, ROW), "the list under the drawer").toBeGreaterThan(0);
    expect(
      await textOf(session, frame, `${BODY} .Trivy-banner--critical .Trivy-banner__title`),
    ).toBe("Not looked at");
    expect(await textOf(session, frame, BODY)).toMatch(/does not mean it is clean/);
    expect(await countOf(session, frame, `${BODY} [data-section="trivy-workload-findings"]`)).toBe(
      0,
    );
    expect(
      await countOf(session, frame, `${BODY} [data-section="trivy-workload-commands"] code`),
      "no commands to look further",
    ).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "Trivy")).toEqual([]);

    await closeDrawer(session, frame);
  }, 90_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
