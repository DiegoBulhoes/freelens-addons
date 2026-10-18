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
  GROUP,
  INSTANCES,
  LISTS,
  MONITORS,
  NODES,
  PODS,
  RULES,
  rowsOf,
  USAGE_GROUP,
  untilState,
} from "../support/lists";

// Counts are "more than none": a number would be the dev cluster's contents.

const PAGES: { id: string; group: string | string[]; headline: RegExp; rows: string }[] = [
  {
    id: "prometheus-overview",
    group: GROUP,
    headline:
      /^\d+ of \d+ (monitors?|rules?|instances?)(, \d+ of \d+ (rules?|instances?))* needs? attention$|^\d+ monitors? and \d+ rules?, none needing attention$/,
    rows: '[data-section="prometheus-attention"] .Prometheus-row',
  },
  {
    id: "prometheus-monitors",
    group: GROUP,
    headline: /^Monitors \d+ items?$/,
    rows: rowsOf(MONITORS),
  },
  { id: "prometheus-rules", group: GROUP, headline: /^Rules \d+ items?$/, rows: rowsOf(RULES) },
  {
    id: "prometheus-instances",
    group: GROUP,
    headline: /^Instances \d+ items?$/,
    rows: rowsOf(INSTANCES),
  },
  {
    id: "prometheus-usage-nodes",
    group: USAGE_GROUP,
    headline: /^Nodes \d+ items?$/,
    rows: rowsOf(NODES),
  },
  {
    id: "prometheus-usage-pods",
    group: USAGE_GROUP,
    headline: /^Pods \d+ items?$/,
    rows: rowsOf(PODS),
  },
];

// Each state the seed declares, as the page names it.
const MONITOR_STATES: [key: string, state: string][] = [
  ["monitoring/prom-self", "Healthy"],
  ["monitoring/down-path", "Down"],
  ["monitoring/rejected", "Rejected"],
  ["prom-apps/orphan", "Not selected"],
  ["prom-outside/excluded", "Namespace excluded"],
  ["prom-apps/no-service", "No target"],
  ["prom-apps/wrong-port", "Port missing"],
  ["prom-apps/no-endpoints", "No endpoints"],
  ["prom-apps/otel-self", "Unknown"],
  ["prom-apps/prom-pods", "Healthy"],
  ["prom-apps/static-self", "Healthy"],
];

const RULE_STATES: [key: string, state: string][] = [
  ["prom-apps/always-firing", "Firing"],
  ["prom-apps/recording", "Loaded"],
  ["prom-apps/unselected-rule", "Not selected"],
  ["prom-outside/excluded-rule", "Namespace excluded"],
  ["prom-apps/broken-rule", "Rejected"],
  ["prom-apps/pending-rule", "Pending"],
  ["prom-apps/failing-rule", "Evaluation failing"],
];

const INSTANCE_STATES: [key: string, kind: string, state: string][] = [
  ["monitoring/seed", "Prometheus", "Available"],
  ["monitoring/seed", "Alertmanager", "Available"],
  ["prom-broken/no-image", "Prometheus", "Not available"],
  ["monitoring/agent", "PrometheusAgent", "Paused"],
];

describe("every page the Prometheus extension registers renders", () => {
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
      await clickSidebar(session, frame, page.id, page.group);

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
      expect(await textOf(session, frame, ".Prometheus-page__headline")).toMatch(page.headline);
    }, 60_000);
  }

  it.each(MONITOR_STATES)(
    "reads monitor %s as %s",
    async (key, state) => {
      await clickSidebar(session, frame, LISTS.monitors.page, GROUP);

      expect(await untilState(session, frame, MONITORS, key, state)).toBe(state);
    },
    120_000,
  );

  it.each(RULE_STATES)(
    "reads rule %s as %s",
    async (key, state) => {
      await clickSidebar(session, frame, LISTS.rules.page, GROUP);

      expect(await untilState(session, frame, RULES, key, state)).toBe(state);
    },
    120_000,
  );

  it.each(INSTANCE_STATES)(
    "reads %s's %s as %s",
    async (key, kind, state) => {
      await clickSidebar(session, frame, LISTS.instances.page, GROUP);

      expect(await untilState(session, frame, INSTANCES, key, state, kind)).toBe(state);
    },
    120_000,
  );

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
