import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  collectErrors,
  connect,
  countOf,
  type ErrorLog,
  openDevCluster,
  selectAllNamespaces,
  selectNamespace,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  cellOf,
  column,
  GROUP,
  INSTANCES,
  LISTS,
  MONITORS,
  PODS,
  RULES,
  rowsOf,
  USAGE_GROUP,
  untilLive,
  untilState,
} from "../support/lists";

// Not `openWorkbench`: widening the scope before our pages mount hides the defect.

// Its monitors and rules reach Services, pods and Prometheuses in other namespaces.
const APPS = "prom-apps";

const MONITOR_STATES: [key: string, state: string][] = [
  ["prom-apps/orphan", "Not selected"],
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
  ["prom-apps/broken-rule", "Rejected"],
  ["prom-apps/pending-rule", "Pending"],
  ["prom-apps/failing-rule", "Evaluation failing"],
];

describe("narrowing the namespace scope under the Prometheus pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  const scopeTo = async (namespace: string) => {
    await clickSidebar(session, frame, "pods", "workloads");
    await selectNamespace(session, frame, namespace);
  };

  beforeAll(async () => {
    session = await connect();
    errors = collectErrors(session);
    frame = await openDevCluster(session);
    await scopeTo(APPS);
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

  const namespacesShown = async (section: string) => [
    ...new Set(await column(session, frame, section, "Namespace")),
  ];

  it.each(MONITOR_STATES)(
    "still reads monitor %s as %s",
    async (key, state) => {
      await clickSidebar(session, frame, LISTS.monitors.page, GROUP);

      expect(await untilState(session, frame, MONITORS, key, state)).toBe(state);
    },
    120_000,
  );

  it("lists no monitor from another namespace", async () => {
    await clickSidebar(session, frame, LISTS.monitors.page, GROUP);
    await untilLive(session, frame, MONITORS);

    expect(await namespacesShown(MONITORS)).toEqual([APPS]);
  }, 120_000);

  it.each(RULE_STATES)(
    "still reads rule %s as %s",
    async (key, state) => {
      await clickSidebar(session, frame, LISTS.rules.page, GROUP);

      expect(await untilState(session, frame, RULES, key, state)).toBe(state);
    },
    120_000,
  );

  it("lists no rule from another namespace", async () => {
    await clickSidebar(session, frame, LISTS.rules.page, GROUP);
    await untilLive(session, frame, RULES);

    expect(await namespacesShown(RULES)).toEqual([APPS]);
  }, 120_000);

  it("lists no instance, as none runs there", async () => {
    await clickSidebar(session, frame, LISTS.instances.page, GROUP);

    expect(
      await waitFor("the empty note", async () => {
        const note = await textOf(session, frame, `${INSTANCES} .Prometheus-section__note`);

        return note || undefined;
      }),
    ).toBe("No Prometheus, PrometheusAgent or Alertmanager in the namespaces in scope.");
    expect(await countOf(session, frame, rowsOf(INSTANCES))).toBe(0);
  }, 120_000);

  it("keeps the figures of the pods in scope on the Usage Pods page, and lists no other", async () => {
    await scopeTo("monitoring");
    await clickSidebar(session, frame, LISTS.pods.page, USAGE_GROUP);

    const key = "monitoring/prometheus-seed-0";

    expect(
      await waitFor(
        `${key}'s CPU`,
        async () => {
          const text = await cellOf(session, frame, PODS, key, "CPU");

          return /^\d/.test(text) ? text : undefined;
        },
        120_000,
      ),
    ).toMatch(/^\d+(\.\d+)?m?( · |$)/);
    expect(await namespacesShown(PODS)).toEqual(["monitoring"]);
  }, 180_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
