import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  collectErrors,
  connect,
  countOf,
  drawerTitle,
  type ErrorLog,
  freshClusterFrame,
  selectAllNamespaces,
  selectNamespace,
  shownDrawer,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";

// Not `openWorkbench`: narrowing the scope before our pages mount would hide a store that ignores it.

const DRAWER = ".MongoDBObjectDrawer";
const LIST = '[data-section="mongodb-clusters"]';
// The seed's second namespace, with orders-rs alone in it.
const APPS = "mongodb-apps";
// Has no MongoDB cluster; it is only selected, never written to.
const EMPTY_NAMESPACE = "kube-public";

describe("changing the namespace scope under the MongoDB pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    session = await connect();
    errors = collectErrors(session);
    frame = await freshClusterFrame(session);
    await clickSidebar(session, frame, "pods", "workloads");
  }, 180_000);

  // The scope is the host's, so a narrowed one would follow the next suite.
  afterAll(async () => {
    try {
      await clickSidebar(session, frame, "pods", "workloads");
      await selectAllNamespaces(session, frame);
    } finally {
      session?.close();
    }
  }, 60_000);

  const clusterNames = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll('${LIST} tbody tr')].map((row) => (row.children[1]?.textContent ?? "").split(" · ")[0])`,
      frame,
    );

  const headlineMatching = (matching: RegExp) =>
    waitFor(`the headline matching ${matching}`, async () => {
      const text = await textOf(session, frame, ".MongoDB-page__headline");

      return matching.test(text) ? text : undefined;
    });

  it("shows only the second namespace's cluster when scoped to it", async () => {
    await selectNamespace(session, frame, APPS);
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");

    expect(
      await waitFor("orders-rs alone", async () => {
        const names = await clusterNames();

        return names.length === 1 && names[0] === "orders-rs" ? names : undefined;
      }),
    ).toEqual(["orders-rs"]);

    await clickSidebar(session, frame, "mongodb-overview", "mongodb");
    expect(await headlineMatching(/^1 cluster, all healthy$/)).toBeTruthy();
  }, 120_000);

  it("reads that cluster's agents, volumes and Secrets from its own namespace", async () => {
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor(
      "the rows",
      async () => (await countOf(session, frame, `${LIST} tbody tr`)) || undefined,
    );
    await session.evaluate(
      `document.querySelector('${LIST} tbody tr td:nth-child(2)').click()`,
      frame,
    );
    await waitFor("orders-rs's drawer", async () =>
      (await drawerTitle(session, frame, DRAWER)) === "Cluster: orders-rs" ? true : undefined,
    );

    const members = await waitFor("orders-rs-0's role", async () => {
      const rows = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].map((each) => each.textContent)`,
        frame,
      );

      return rows.some((each) => each.startsWith("Primary")) ? rows : undefined;
    });

    expect(members.find((each) => each.includes("orders-rs-0"))).toMatch(/^Primary/);

    const text = await session.evaluate<string>(`${shownDrawer(DRAWER)}?.textContent ?? ""`, frame);

    expect(text).toMatch(/orders-admin.*connection in /);
    expect(text).not.toMatch(/does not exist|not bound/);
  }, 120_000);

  it("reports no cluster while scoped to a namespace with none", async () => {
    await clickSidebar(session, frame, "mongodb-overview", "mongodb");
    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    expect(await headlineMatching(/^No MongoDB clusters$/)).toBeTruthy();

    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    expect(
      await waitFor("the empty list", async () =>
        (await countOf(session, frame, `${LIST} tbody tr`)) === 0
          ? (await textOf(session, frame, `${LIST} .MongoDB-section__note`)) || undefined
          : undefined,
      ),
    ).toBe("No MongoDB clusters in the namespaces in scope.");
  }, 120_000);

  it("catches up once the scope widens, both namespaces together", async () => {
    await selectAllNamespaces(session, frame);
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");

    expect(
      await waitFor("both namespaces' clusters", async () => {
        const names = await clusterNames();

        return names.includes("orders-rs") && names.includes("catalog-rs") ? names : undefined;
      }),
    ).toEqual(expect.arrayContaining(["orders-rs", "catalog-rs"]));
  }, 120_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
