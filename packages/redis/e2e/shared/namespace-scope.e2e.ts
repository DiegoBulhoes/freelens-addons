import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  collectErrors,
  connect,
  type ErrorLog,
  freshClusterFrame,
  selectAllNamespaces,
  selectNamespace,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";

// Not `openWorkbench`: widening the scope before our pages mount hides the defect.

/** The seed puts every Redis object here. */
const SEED_NAMESPACE = "redis";
const EMPTY_NAMESPACE = "default";
const COUNTED = /of [1-9]\d* Redis objects? needs? attention/;
const LIST = '[data-section="redis-replications"] tbody tr';

describe("changing the namespace scope under the Redis pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    session = await connect();
    errors = collectErrors(session);
    frame = await freshClusterFrame(session);
    await clickSidebar(session, frame, "pods", "workloads");
  }, 180_000);

  afterAll(() => session?.close());

  const headlineMatching = (matching: RegExp) =>
    waitFor(`the headline matching ${matching}`, async () => {
      const text = await textOf(session, frame, ".Redis-page__headline");

      return matching.test(text) ? text : undefined;
    });

  it("reports nothing while scoped to a namespace with no Redis objects", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    await clickSidebar(session, frame, "redis-overview", "redis");

    expect(await headlineMatching(/^No Redis$/)).toBeTruthy();
  }, 120_000);

  it("catches up once the scope widens to the seed's namespace", async () => {
    await clickSidebar(session, frame, "pods", "workloads");
    await selectNamespace(session, frame, SEED_NAMESPACE);
    await clickSidebar(session, frame, "redis-overview", "redis");

    expect(await headlineMatching(COUNTED)).toMatch(COUNTED);
  }, 120_000);

  it("catches up once the scope widens to every namespace", async () => {
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);
    await clickSidebar(session, frame, "redis-overview", "redis");

    expect(await headlineMatching(COUNTED)).toMatch(COUNTED);
  }, 120_000);

  it.each([
    "redis-overview",
    "redis-replications",
    "redis-clusters",
    "redis-standalones",
    "redis-sentinels",
  ])(
    "offers the selector on %s",
    async (id) => {
      await clickSidebar(session, frame, id, "redis");

      expect(
        await waitFor(`${id}'s namespace selector`, async () => {
          const count = await session.evaluate<number>(
            `document.querySelectorAll('.Redis-namespaces [class*="Select__control"]').length`,
            frame,
          );

          return count > 0 ? count : undefined;
        }),
      ).toBe(1);
    },
    60_000,
  );

  it("empties the replications list from its own selector, and fills it again", async () => {
    const rows = () =>
      session.evaluate<number>(`document.querySelectorAll(${JSON.stringify(LIST)}).length`, frame);

    await clickSidebar(session, frame, "redis-replications", "redis");
    await waitFor("the replications", async () => (await rows()) || undefined);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    expect(
      await waitFor("the list to empty", async () => ((await rows()) === 0 ? true : undefined)),
    ).toBe(true);

    await selectAllNamespaces(session, frame);
    expect(
      await waitFor("the replications back", async () => (await rows()) || undefined),
    ).toBeGreaterThan(0);
  }, 120_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
