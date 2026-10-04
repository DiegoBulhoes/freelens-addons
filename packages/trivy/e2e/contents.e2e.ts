import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";
import { column, openWorkloads, ROW } from "./workloads";

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
    expect(await countOf(ROW)).toBe(known);

    // Bounds, not equality: they hold however far the scanner has got.
    expect(known, "a judged workload is missing").toBeGreaterThanOrEqual(judged.size);
    expect(known, "a workload no report names").toBeLessThanOrEqual(reported.size);
  }, 150_000);

  it("orders the list by state, then by how bad it is, until a header is clicked", async () => {
    await openWorkloads(session, frame);

    const states = await column(session, frame, "Coverage");
    const criticals = await column(session, frame, "Critical");
    const highs = await column(session, frame, "High");
    const named = {
      scanned: "scanned",
      "no verdict": "read-but-no-verdict",
      "not looked at": "never-looked",
    };
    const rows = states.map((state, at) => ({
      state: named[state as keyof typeof named] ?? "",
      critical: Number.parseInt(criticals[at] ?? "", 10) || 0,
      high: Number.parseInt(highs[at] ?? "", 10) || 0,
    }));

    expect(rows.length).toBeGreaterThan(1);

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

  it("lists the RBAC findings once per check rather than once per role", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await waitFor(
      "the checks",
      async () => (await countOf(".Trivy-table tbody tr")) > 0 || undefined,
    );

    const rows = await session.evaluate<{ id: string; roles: number }[]>(
      `(() => {
        const headers = [...document.querySelectorAll('.Trivy-table thead th')]
          .map((each) => each.textContent.trim());
        const at = (title) => headers.indexOf(title);
        return [...document.querySelectorAll('.Trivy-table tbody tr')].map((row) => ({
          id: row.children[at("ID")].textContent.trim(),
          roles: Number(row.children[at("Roles")].textContent) +
            Number(row.children[at("ClusterRoles")].textContent),
        }));
      })()`,
      frame,
    );

    expect(new Set(rows.map((row) => row.id)).size, "a check is listed more than once").toBe(
      rows.length,
    );
    expect(
      rows.filter((row) => row.roles > 1).length,
      "no check gathers more than one role, so nothing is grouped",
    ).toBeGreaterThan(0);
  }, 150_000);

  it("counts no more roles under its title than the cluster has", async () => {
    const roles = await clusterItems(session, frame, ROLES);
    const clusterRoles = await clusterItems(session, frame, CLUSTER_ROLES);

    await clickSidebar(session, frame, "trivy-rbac", "trivy");

    const subline = await waitFor("the RBAC subline", async () => {
      const text = await textOf(session, frame, ".Trivy-page__subline");

      return text.length > 0 ? text : undefined;
    });

    const match = /(\d+) critical grants? across (\d+) roles?/.exec(subline);

    expect(match, `the subline does not count: ${subline}`).not.toBeNull();
    expect(Number(match?.[2]), "more roles than the cluster has").toBeLessThanOrEqual(
      roles.length + clusterRoles.length,
    );
    expect(Number(match?.[2])).toBeGreaterThan(0);
  }, 150_000);
});
