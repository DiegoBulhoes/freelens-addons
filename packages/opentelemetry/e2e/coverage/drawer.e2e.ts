import { describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import { countOf, type ErrorLog } from "../../../../build/e2e/freelens";
import { DRAWER, openWorkload, WORKLOAD_BODY } from "../support/lists";
import { factOf, follow, terms, useWorkbench } from "../support/opentelemetry";

describe("an OpenTelemetry drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  useWorkbench((opened) => ({ session, frame, errors } = opened), true);

  it("opens checkout from its row, with where its opt-in comes from and its pods", async () => {
    await openWorkload(session, frame, "otel-apps/checkout", "Deployment");

    expect(await terms(session, frame)).toEqual(
      expect.arrayContaining([
        "Language",
        "Opted in by",
        "Annotation",
        "Resolves to",
        "Container",
        "Endpoint",
        "Exports to",
        "Host list",
      ]),
    );

    const pods = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="opentelemetry-pods"] .OpenTelemetry-row__state')].map((each) => each.textContent)`,
      frame,
    );

    expect(pods.length).toBeGreaterThan(0);
    expect(pods.every((each) => each === "Injected")).toBe(true);
    expect(
      await countOf(
        session,
        frame,
        `${DRAWER} [data-section="opentelemetry-workload-commands"] button`,
      ),
    ).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "OpenTelemetry")).toEqual([]);
  }, 90_000);

  it.each([
    ["otel-apps/checkout", "Deployment", "Deployments", "/deployments"],
    ["otel-apps/ledger", "StatefulSet", "StatefulSets", "/statefulsets"],
    ["otel-namespace/node-agent", "DaemonSet", "DaemonSets", "/daemonsets"],
    ["otel-batch/nightly", "CronJob", "CronJobs", "/cronjobs"],
    ["otel-batch/migrate", "Job", "Jobs", "/jobs"],
  ])(
    "leaves %s's drawer for the host's %s list, narrowed to it",
    async (key, kind, list, path) => {
      const name = key.split("/")[1] ?? "";

      await openWorkload(session, frame, key, kind);
      await follow(session, frame, `${name} in the ${list} list`, path, name);
    },
    90_000,
  );

  it("leaves checkout's drawer for the Instrumentation it resolves to", async () => {
    await openWorkload(session, frame, "otel-apps/checkout", "Deployment");
    await follow(
      session,
      frame,
      "python in the Instrumentations list",
      "/crd/opentelemetry.io/instrumentations",
      "python",
    );
  }, 90_000);

  it("says where checkout's agent exports: the gateway, which runs", async () => {
    await openWorkload(session, frame, "otel-apps/checkout", "Deployment");

    // Exact: a warning under the value would be part of its text.
    expect(await factOf(session, frame, "Exports to")).toBe("otel-collectors/gateway, Ready");
  }, 60_000);

  it("explains a Misplaced row: the key is on the Deployment, not its pod template", async () => {
    await openWorkload(session, frame, "otel-apps/misplaced", "Deployment");

    expect(await factOf(session, frame, "State")).toBe("Misplaced");
    expect(
      await session.evaluate<string>(
        `document.querySelector(${JSON.stringify(WORKLOAD_BODY)})?.textContent ?? ""`,
        frame,
      ),
    ).toMatch(/belongs on the pod template/);
    expect(await designViolations(session, frame, "OpenTelemetry")).toEqual([]);
  }, 60_000);

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
