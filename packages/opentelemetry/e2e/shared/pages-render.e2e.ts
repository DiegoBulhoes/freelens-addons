import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  COLLECTOR_ROWS,
  COLLECTORS,
  LIST,
  openCollectors,
  openCoverage,
  ROWS,
  reasonOf,
  rowNamed,
  stateOf,
} from "../support/lists";

// Counts are "more than none": a number would be the dev cluster's contents.

// Each state the seed sets up, and what its reason must name.
const SEEDED: [key: string, state: string, reason: RegExp][] = [
  ["otel-apps/misplaced", "Misplaced", /belongs on the pod template/],
  ["otel-apps/typo", "No Instrumentation", /otel-apps\/absent does not exist/],
  ["otel-orphan/orphan", "No Instrumentation", /No Instrumentation in otel-orphan/],
  ["otel-ambiguous/ambiguous", "Ambiguous", /python-a/],
  ["otel-orphan/cross-ns", "Injected", /./],
  ["otel-namespace/inherited", "Injected", /./],
  ["otel-namespace/node-agent", "Injected", /./],
  ["otel-namespace/opted-out", "Opted out", /"false"/],
  ["otel-blocked/go-service", "Blocked", /does not inject Go/],
  ["otel-blocked/polyglot", "Blocked", /each must name its containers/],
  ["otel-tls/secure", "Blocked", /Secret otel-ca named by otel-tls\/python is not in otel-tls/],
  ["otel-batch/nightly", "Injected", /./],
  ["otel-batch/migrate", "No Instrumentation", /No Instrumentation in otel-batch/],
];

const SEEDED_COLLECTORS: [key: string, state: RegExp][] = [
  ["otel-collectors/gateway", /^Ready$/],
  ["otel-collectors/sidecar", /^In [1-9]\d* pods?$/],
  ["otel-allocator/allocator", /^Target allocator (crash looping|not ready)$/],
];

const PAGES: { id: string; headline: RegExp; rows: string }[] = [
  {
    id: "opentelemetry-overview",
    headline:
      /^\d+ of \d+ (workloads?|collectors?)( and \d+ of \d+ collectors?)? needs? attention$|^\d+ instrumented workloads?, all injected$/,
    rows: ".OpenTelemetry-row",
  },
  { id: "opentelemetry-coverage", headline: /^Coverage/, rows: ROWS },
  { id: "opentelemetry-collectors", headline: /^Collectors/, rows: COLLECTOR_ROWS },
];

describe("every page the OpenTelemetry extension registers renders", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  for (const page of PAGES) {
    it(`opens ${page.id}, with rows`, async () => {
      await clickSidebar(session, frame, page.id, "opentelemetry");

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
      expect(await textOf(session, frame, ".OpenTelemetry-page__headline")).toMatch(page.headline);
    }, 60_000);
  }

  it("tells a workload whose pods carry the agent from one whose pods need a restart", async () => {
    await clickSidebar(session, frame, "opentelemetry-coverage", "opentelemetry");

    const states = await waitFor("both states", async () => {
      const found = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${ROWS} .OpenTelemetry-status`)})].map((each) => each.textContent.trim())`,
        frame,
      );

      return found.includes("Injected") && found.includes("Restart needed") ? found : undefined;
    });

    expect(states).toContain("Injected");
    expect(await stateOf(session, frame, LIST, "otel-late/late")).toBe("Restart needed");
  }, 60_000);

  it("gives a crash-looping collector the cause from its previous log", async () => {
    await clickSidebar(session, frame, "opentelemetry-collectors", "opentelemetry");

    // The cause is read from the pod's log after the list renders.
    const state = await waitFor(
      "broken's cause",
      async () => {
        const text = await session.evaluate<string>(
          `${rowNamed(COLLECTORS, "otel-collectors/broken")}?.querySelector(".OpenTelemetry-truncate")?.textContent ?? ""`,
          frame,
        );

        return /which is not configured/.test(text) ? text : undefined;
      },
      90_000,
    );

    expect(state).toMatch(/^Crash looping/);
  }, 120_000);

  describe("the Coverage list's seeded states", () => {
    beforeAll(() => openCoverage(session, frame), 90_000);

    it.each(SEEDED)("reads %s as %s", async (key, state, reason) => {
      expect(await stateOf(session, frame, LIST, key)).toBe(state);
      expect(await reasonOf(session, frame, LIST, key)).toMatch(reason);
    });
  });

  describe("the Collectors list's seeded states", () => {
    beforeAll(() => openCollectors(session, frame), 90_000);

    it.each(SEEDED_COLLECTORS)(
      "reads %s as %s",
      async (key, state) => {
        // The target allocator's pods are judged once they are listed.
        expect(
          await waitFor(`${key}'s state`, async () => {
            const shown = await stateOf(session, frame, COLLECTORS, key);

            return state.test(shown) ? shown : undefined;
          }).catch(() => stateOf(session, frame, COLLECTORS, key)),
        ).toMatch(state);
      },
      90_000,
    );
  });

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
