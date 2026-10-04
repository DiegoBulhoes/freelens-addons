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

// Not `openWorkbench`: widening the scope before our pages mount hides the defect.

const EMPTY_NAMESPACE = "default";
const COUNTED = /of [1-9]\d* Postgres clusters|All [1-9]\d* Postgres clusters?/;

describe("changing the namespace scope under the CloudNativePG pages", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);
    await clickSidebar(session, frame, "pods", "workloads");
  }, 180_000);

  afterAll(() => session?.close());

  const headlineMatching = (matching: RegExp) =>
    waitFor(`the headline matching ${matching}`, async () => {
      const text = await textOf(session, frame, ".CNPG-page__headline");

      return matching.test(text) ? text : undefined;
    });

  it("reports nothing while scoped to a namespace with no clusters", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");

    expect(await headlineMatching(/^No Postgres clusters found$/)).toBeTruthy();
  }, 120_000);

  it("catches up once the scope widens", async () => {
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");

    expect(await headlineMatching(COUNTED)).toMatch(COUNTED);
  }, 120_000);

  it.each([
    "cnpg-overview",
    "cnpg-clusters",
    "cnpg-backups",
    "cnpg-schedules",
    "cnpg-poolers",
    "cnpg-logical",
  ])(
    "offers the selector on %s",
    async (id) => {
      await clickSidebar(session, frame, id, "cnpg");

      expect(
        await waitFor(`${id}'s namespace selector`, async () => {
          const count = await session.evaluate<number>(
            `document.querySelectorAll('.CNPG-namespaces [class*="Select__control"]').length`,
            frame,
          );

          return count > 0 ? count : undefined;
        }),
      ).toBe(1);
    },
    60_000,
  );

  it("empties the clusters list from its own selector, and fills it again", async () => {
    const rows = () =>
      session.evaluate<number>(
        `document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr').length`,
        frame,
      );

    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    await waitFor("the clusters", async () => (await rows()) || undefined);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    expect(
      await waitFor("the list to empty", async () => ((await rows()) === 0 ? true : undefined)),
    ).toBe(true);

    await selectAllNamespaces(session, frame);
    expect(
      await waitFor("the clusters back", async () => (await rows()) || undefined),
    ).toBeGreaterThan(0);
  }, 120_000);
});
