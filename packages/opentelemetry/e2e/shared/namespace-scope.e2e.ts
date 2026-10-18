import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  collectErrors,
  connect,
  countOf,
  type ErrorLog,
  freshClusterFrame,
  selectAllNamespaces,
  selectNamespace,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { COLLECTOR_ROWS, COLLECTORS, LIST, ROWS } from "../support/lists";

// Not `openWorkbench`: widening the scope before our pages mount hides the defect.

// Has neither workloads that opt in nor collectors; it is only selected, never written to.
const EMPTY_NAMESPACE = "kube-public";
const COUNTED =
  /^\d+ of \d+ (workloads?|collectors?)( and \d+ of \d+ collectors?)? needs? attention$|^\d+ instrumented workloads?, all injected$/;

describe("changing the namespace scope under the OpenTelemetry pages", () => {
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

  const headlineMatching = (matching: RegExp) =>
    waitFor(`the headline matching ${matching}`, async () => {
      const text = await textOf(session, frame, ".OpenTelemetry-page__headline");

      return matching.test(text) ? text : undefined;
    });

  it("reports nothing while scoped to a namespace with no instrumented workload", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    await clickSidebar(session, frame, "opentelemetry-overview", "opentelemetry");

    expect(await headlineMatching(/^No workload opts in to auto-instrumentation$/)).toBeTruthy();
  }, 120_000);

  it("catches up once the scope widens", async () => {
    await clickSidebar(session, frame, "pods", "workloads");
    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    await selectAllNamespaces(session, frame);
    await clickSidebar(session, frame, "opentelemetry-overview", "opentelemetry");

    expect(await headlineMatching(COUNTED)).toMatch(COUNTED);
  }, 120_000);

  it.each(["opentelemetry-overview", "opentelemetry-coverage", "opentelemetry-collectors"])(
    "offers the selector on %s",
    async (id) => {
      await clickSidebar(session, frame, id, "opentelemetry");

      expect(
        await waitFor(`${id}'s namespace selector`, async () => {
          const count = await countOf(
            session,
            frame,
            '.OpenTelemetry-namespaces [class*="Select__control"]',
          );

          return count > 0 ? count : undefined;
        }),
      ).toBe(1);
    },
    60_000,
  );

  it.each([
    ["opentelemetry-coverage", LIST, ROWS],
    ["opentelemetry-collectors", COLLECTORS, COLLECTOR_ROWS],
  ])(
    "empties %s from its own selector, and fills it again",
    async (id, section, rows) => {
      await clickSidebar(session, frame, id, "opentelemetry");
      await waitFor(`${id}'s rows`, async () => (await countOf(session, frame, rows)) || undefined);

      await selectNamespace(session, frame, EMPTY_NAMESPACE);
      try {
        expect(
          await waitFor(`${id} to empty`, async () =>
            (await countOf(session, frame, rows)) === 0 &&
            (await countOf(session, frame, `${section} .OpenTelemetry-section__note`))
              ? true
              : undefined,
          ),
        ).toBe(true);
      } finally {
        await selectAllNamespaces(session, frame);
      }
      expect(
        await waitFor(
          `${id}'s rows back`,
          async () => (await countOf(session, frame, rows)) || undefined,
        ),
      ).toBeGreaterThan(0);
    },
    120_000,
  );

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
