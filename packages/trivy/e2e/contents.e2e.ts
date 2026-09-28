import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * Whether what the pages show agrees with the cluster, and with itself.
 *
 * Every other file here checks that something rendered. This one checks that what
 * rendered is true. Where the truth is a count the cluster can be asked for, it
 * is asked — of the host's own proxy, from inside the frame — so nothing about
 * the development cluster is written down here.
 *
 * Where it cannot be asked for without re-implementing the rule under test, an
 * invariant is used instead: two pages reading one store must agree, a report
 * cannot describe more workloads than there are reports, and a list said to be
 * ordered has to be ordered.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

const VULNERABILITY_REPORTS = "/apis/aquasecurity.github.io/v1alpha1/vulnerabilityreports";
const SBOM_REPORTS = "/apis/aquasecurity.github.io/v1alpha1/sbomreports";
const CONFIG_AUDIT_REPORTS = "/apis/aquasecurity.github.io/v1alpha1/configauditreports";
const ROLES = "/apis/rbac.authorization.k8s.io/v1/roles";
const CLUSTER_ROLES = "/apis/rbac.authorization.k8s.io/v1/clusterroles";

describe("what the Trivy pages say", () => {
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

  /** The number a dashboard card shows above its label, or -1 when absent. */
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

  it("knows as many workloads as the picker lists, and no more than there are reports", async () => {
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

    await clickSidebar(session, frame, "trivy-workloads", "trivy");

    const listed = await waitFor("the picker", async () => {
      const rows = await countOf(".Trivy-picker__item");

      return rows > 0 ? rows : undefined;
    });

    // Two pages, one store: the overview's count and the picker's list are the
    // same set seen twice, and a disagreement means one of them is stale.
    expect(listed, "the picker lists a different number than the overview counts").toBe(known);

    // Every workload with a verdict is known, and nothing is known that no
    // report of any kind names. Both hold however far the scanner has got, which
    // is what survives re-seeding.
    expect(known, "a judged workload is missing").toBeGreaterThanOrEqual(judged.size);
    expect(known, "a workload no report names").toBeLessThanOrEqual(reported.size);
  }, 150_000);

  it("orders the picker by state, then by how bad it is", async () => {
    await clickSidebar(session, frame, "trivy-workloads", "trivy");
    await waitFor(
      "the picker",
      async () => (await countOf(".Trivy-picker__item")) > 0 || undefined,
    );

    const rows = await session.evaluate<{ state: string; critical: number; high: number }[]>(
      `[...document.querySelectorAll('.Trivy-picker__item')].map((row) => ({
         state: ({ "scanned": "scanned", "no verdict": "read-but-no-verdict", "not looked at": "never-looked" })[
           (row.querySelector('.Trivy-picker__meta')?.textContent ?? "").split("·").pop().trim()
         ] ?? "",
         critical: Number.parseInt(row.querySelector('.Trivy-severity--CRITICAL')?.textContent ?? "0", 10),
         high: Number.parseInt(row.querySelector('.Trivy-severity--HIGH')?.textContent ?? "0", 10),
       }))`,
      frame,
    );

    expect(rows.length).toBeGreaterThan(1);

    // `sortRows` puts what the scanner has not judged first, then sorts by
    // criticals and highs descending. The rule is unit tested; what this checks
    // is that the page renders the order the rule returned rather than the order
    // the store happened to hold.
    const rank = { "never-looked": 0, "read-but-no-verdict": 1, scanned: 2 } as const;

    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1];
      const current = rows[index];

      if (previous === undefined || current === undefined) continue;

      const previousRank = rank[previous.state as keyof typeof rank] ?? 99;
      const currentRank = rank[current.state as keyof typeof rank] ?? 99;

      expect(
        previousRank,
        `row ${index} is in a state that should sort earlier`,
      ).toBeLessThanOrEqual(currentRank);

      if (previousRank !== currentRank) continue;

      if (previous.critical !== current.critical) {
        expect(
          previous.critical,
          `row ${index} has more criticals than the row above`,
        ).toBeGreaterThan(current.critical);
      } else {
        expect(
          previous.high,
          `row ${index} has more highs than the row above`,
        ).toBeGreaterThanOrEqual(current.high);
      }
    }
  }, 150_000);

  it("groups the RBAC findings by check rather than by role", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await waitFor("the checks", async () => (await countOf(".Trivy-box")) > 0 || undefined);

    const titles = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.Trivy-box__title')].map((each) => each.textContent.trim())`,
      frame,
    );

    // One section per check, each check appearing once. Grouped by role instead,
    // the same check would appear under every role that fails it — which is what
    // the page is for: a reader wants "who can read secrets", not one section per
    // role repeating the same sentence.
    expect(titles.length).toBe(await countOf(".Trivy-box"));
    expect(new Set(titles).size, "a check is listed more than once").toBe(titles.length);

    const withSeveralRoles = await session.evaluate<number>(
      `[...document.querySelectorAll('.Trivy-box')]
         .filter((each) => each.querySelectorAll('span.Trivy-chip').length > 1).length`,
      frame,
    );

    expect(
      withSeveralRoles,
      "no check gathers more than one role, so nothing is grouped",
    ).toBeGreaterThan(0);
  }, 150_000);

  it("counts no more roles in its headline than the cluster has", async () => {
    const roles = await clusterItems(session, frame, ROLES);
    const clusterRoles = await clusterItems(session, frame, CLUSTER_ROLES);

    await clickSidebar(session, frame, "trivy-rbac", "trivy");

    const headline = await waitFor("the RBAC headline", async () => {
      const text = await textOf(session, frame, ".Trivy-page__headline");

      return text.length > 0 ? text : undefined;
    });

    const match = /(\d+) critical grants across (\d+) roles/.exec(headline);

    expect(match, `the headline does not count: ${headline}`).not.toBeNull();
    expect(Number(match?.[2]), "more roles than the cluster has").toBeLessThanOrEqual(
      roles.length + clusterRoles.length,
    );
    expect(Number(match?.[2])).toBeGreaterThan(0);
  }, 150_000);
});
