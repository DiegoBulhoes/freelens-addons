import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterFrame,
  connect,
  openCluster,
  selectAllNamespaces,
  selectNamespace,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";
import { EMPTY as EMPTY_NOTE, ROW } from "./workloads";

// Narrows before our pages mount: openWorkbench widens first, which hides the defect.
// Twin of packages/argocd/e2e/namespace-scope.e2e.ts.

// Holds no scanned workload and no Role.
const EMPTY_NAMESPACE = "default";

describe("changing the namespace scope under the Trivy pages", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);

    // The namespace control lives on the host's list pages.
    await clickSidebar(session, frame, "pods", "workloads");
  }, 180_000);

  afterAll(() => session?.close());

  it("reports emptiness while scoped to a namespace that has nothing", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const headline = await waitFor("the Trivy headline", async () => {
      const text = await textOf(session, frame, ".Trivy-page__headline");

      return text.length > 0 ? text : undefined;
    });

    expect(headline).toMatch(/No workload in the selected namespaces/);
  }, 120_000);

  it("catches up once the scope widens", async () => {
    // The stores are already loaded here, which is the trap.
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);

    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const headline = await waitFor("the Trivy headline to count something", async () => {
      const text = await textOf(session, frame, ".Trivy-page__headline");

      return /No workload in the selected namespaces/.test(text) || text.length === 0
        ? undefined
        : text;
    });

    expect(headline).toMatch(/critical findings? in [1-9]\d* scanned workloads?/);
  }, 120_000);
});

// The Vulnerabilities list is the host's own.
const OWN_SCREENS = ["trivy-dashboard", "trivy-workloads", "trivy-rbac"];

const COUNTING = /critical findings? in [1-9]\d* scanned workloads?/;
const EMPTY = /No workload in the selected namespaces/;

describe("the namespace selector on the Trivy screens", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const headline = (matching: RegExp) =>
    waitFor(`a headline matching ${matching}`, async () => {
      const text = await textOf(session, frame, ".Trivy-page__headline");

      return matching.test(text) ? text : undefined;
    });

  const columnTotal = (title: string) =>
    session.evaluate<number>(
      `(() => {
        const headers = [...document.querySelectorAll('.Trivy-table thead th')]
          .map((each) => each.textContent.trim());
        const at = headers.indexOf(${JSON.stringify(title)});
        if (at === -1) return -1;
        return [...document.querySelectorAll('.Trivy-table tbody tr')]
          .reduce((sum, row) => sum + Number.parseInt(row.children[at]?.textContent ?? "0", 10), 0);
      })()`,
      frame,
    );

  it.each(OWN_SCREENS)(
    "offers it on %s",
    async (id) => {
      await clickSidebar(session, frame, id, "trivy");

      const selectors = await waitFor(`${id}'s namespace selector`, async () => {
        const count = await countOf('.Trivy-namespaces [class*="Select__control"]');

        return count > 0 ? count : undefined;
      });

      expect(selectors).toBe(1);
    },
    60_000,
  );

  it("narrows the overview from its own selector, with the page open", async () => {
    await clickSidebar(session, frame, "trivy-dashboard", "trivy");
    await selectAllNamespaces(session, frame);
    await headline(COUNTING);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    expect(await headline(EMPTY)).toMatch(EMPTY);
  }, 120_000);

  it("widens it again from the same selector", async () => {
    await selectAllNamespaces(session, frame);

    expect(await headline(COUNTING)).toMatch(COUNTING);
  }, 120_000);

  it("empties the workload list and says why, then fills it again", async () => {
    await clickSidebar(session, frame, "trivy-workloads", "trivy");
    await waitFor("the workload list", async () => (await countOf(ROW)) > 0 || undefined);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    const note = await waitFor("the empty list", async () => {
      if ((await countOf(ROW)) > 0) return undefined;

      const text = await textOf(session, frame, EMPTY_NOTE);

      return text.length > 0 ? text : undefined;
    });

    expect(note).toMatch(/selected namespaces/);

    await selectAllNamespaces(session, frame);

    expect(
      await waitFor("the list to fill", async () => {
        const rows = await countOf(ROW);

        return rows > 0 ? rows : undefined;
      }),
    ).toBeGreaterThan(0);
  }, 120_000);

  it("drops the Roles from the RBAC list and keeps the ClusterRoles, then brings them back", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await selectAllNamespaces(session, frame);

    const wide = await waitFor("Roles in the list", async () => {
      const roles = await columnTotal("Roles");

      return roles > 0 ? roles : undefined;
    });

    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    expect(
      await waitFor("the Roles to go", async () =>
        (await columnTotal("Roles")) === 0 ? 0 : undefined,
      ),
    ).toBe(0);
    // A ClusterRole reaches every namespace.
    expect(await columnTotal("ClusterRoles")).toBeGreaterThan(0);

    await selectAllNamespaces(session, frame);

    expect(
      await waitFor("the Roles to return", async () =>
        (await columnTotal("Roles")) === wide ? wide : undefined,
      ),
    ).toBe(wide);
  }, 120_000);
});
