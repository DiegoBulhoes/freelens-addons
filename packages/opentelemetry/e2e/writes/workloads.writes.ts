import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickWhenShown,
  leaveNothingBehind,
  openWorkbench,
  shownDrawer,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  clusterObject,
  confirmDialog,
  type KubeObject,
  notificationMatching,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import {
  appPodsOf,
  DRAWER,
  hasAgent,
  LIST,
  openCoverage,
  openWorkload,
  type Pod,
  stateOf,
  tick,
} from "../support/lists";

const NAMESPACE = "/api/v1/namespaces/otel-late";
const OPT_IN = "instrumentation.opentelemetry.io/inject-python";
const RESTARTED_AT = "kubectl.kubernetes.io/restartedAt";
const WORKLOADS = {
  "otel-late/late": "/apis/apps/v1/namespaces/otel-late/deployments/late",
  "otel-late/late-agent": "/apis/apps/v1/namespaces/otel-late/daemonsets/late-agent",
} as const;

type Late = keyof typeof WORKLOADS;

// otel-late is opted in through its Namespace after its pods started. Every test leaves late and
// late-agent that way: their pods without the agent, the Namespace annotated, Restart needed.
describe("OpenTelemetry writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const js = <T>(code: string) => session.evaluate<T>(code, frame);
  const get = (path: string) => clusterObject(session, frame, path);
  const ready = (pod: KubeObject) =>
    pod.status?.conditions?.some(
      (condition: KubeObject) => condition.type === "Ready" && condition.status === "True",
    ) === true;

  const rolledOut = (workload: KubeObject | undefined) => {
    const status = workload?.status ?? {};

    if ((status.observedGeneration ?? 0) < (workload?.metadata?.generation ?? 1)) return false;
    if (workload?.kind === "DaemonSet") {
      return (
        status.desiredNumberScheduled > 0 &&
        status.updatedNumberScheduled === status.desiredNumberScheduled &&
        status.numberAvailable === status.desiredNumberScheduled
      );
    }

    return (
      status.replicas === workload?.spec?.replicas &&
      status.updatedReplicas === status.replicas &&
      status.availableReplicas === status.replicas
    );
  };

  /** Rolled out, every pod ready and none leaving, and each with the agent or each without. */
  const settled = async (key: Late, injected: boolean) => {
    if (!rolledOut(await get(WORKLOADS[key]))) return false;

    const pods = await appPodsOf(session, frame, key);

    return (
      pods.length > 0 &&
      pods.every(
        (pod) => !pod.metadata.deletionTimestamp && ready(pod) && hasAgent(pod) === injected,
      )
    );
  };

  const shows = async (key: Late, state: string) => {
    await openCoverage(session, frame);

    return waitFor(
      `${key} to read ${state}`,
      async () => ((await stateOf(session, frame, LIST, key)) === state ? true : undefined),
      120_000,
    );
  };

  /** What the webhook makes of a pod created in otel-late now; dryRun=All stores nothing. */
  const dryRunPod = async (): Promise<Pod> => {
    const probe = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { generateName: "webhook-probe-", namespace: "otel-late" },
      spec: { containers: [{ name: "app", image: "busybox:1.36", command: ["true"] }] },
    };
    const { status, body } = await js<{ status: number; body: string }>(
      `fetch("/api-kube${NAMESPACE}/pods?dryRun=All", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: ${JSON.stringify(JSON.stringify(probe))},
      }).then(async (response) => ({ status: response.status, body: await response.text() }))`,
    );

    if (status >= 300) throw new Error(`dry-run pod in otel-late: ${status} ${body.slice(0, 200)}`);

    return JSON.parse(body) as Pod;
  };

  // A merge patch with null is a no-op when the key is absent, so this also runs after a failed write.
  const putBack = async (key: Late) => {
    try {
      await restore(session, frame, "PATCH", NAMESPACE, {
        metadata: { annotations: { [OPT_IN]: null } },
      });
      // The webhook reads Namespaces through the operator's cache, so it may inject a while longer.
      await untilCluster("the webhook to see otel-late opted out", async () =>
        hasAgent(await dryRunPod()) ? undefined : true,
      );
      await restore(session, frame, "PATCH", WORKLOADS[key], {
        spec: { template: { metadata: { annotations: { [RESTARTED_AT]: null } } } },
      });
      await untilCluster(
        `${key} rolled back without the agent`,
        () => settled(key, false),
        10 * 60_000,
      );
    } finally {
      await restore(session, frame, "PATCH", NAMESPACE, {
        metadata: { annotations: { [OPT_IN]: "true" } },
      });
    }
  };

  it("restarts late from its drawer: its new pods carry the agent", async () => {
    await untilCluster("late without the agent", () => settled("otel-late/late", false));

    try {
      await openWorkload(session, frame, "otel-late/late", "Deployment");
      await js(
        `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === "restart_alt").click()`,
      );
      await confirmDialog(session, frame, "Restart", "late");
      await notificationMatching(session, frame, /Restart of otel-late\/late requested/);

      expect(
        (await get(WORKLOADS["otel-late/late"]))?.spec?.template?.metadata?.annotations?.[
          RESTARTED_AT
        ],
      ).toBeTruthy();
      // The kubelet here collects unused images, so the agent's may be pulled again.
      await untilCluster(
        "late's new pods with the agent",
        () => settled("otel-late/late", true),
        10 * 60_000,
      );
      expect(await shows("otel-late/late", "Injected")).toBe(true);
    } finally {
      await leaveNothingBehind(session, frame, "opentelemetry-overview", "opentelemetry");
      await putBack("otel-late/late");
    }

    expect(await shows("otel-late/late", "Restart needed")).toBe(true);
  });

  it("restarts the ticked rows a restart helps: late-agent rolls, checkout is skipped", async () => {
    await untilCluster("late-agent without the agent", () =>
      settled("otel-late/late-agent", false),
    );

    const uids = async () =>
      (await appPodsOf(session, frame, "otel-apps/checkout")).map((pod) => pod.metadata.uid).sort();
    const checkout = await uids();

    expect(checkout.length, "checkout has no pods").toBeGreaterThan(0);

    try {
      await openCoverage(session, frame);
      await tick(session, frame, "otel-late/late-agent");
      await tick(session, frame, "otel-apps/checkout");
      await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

      const dialog = await confirmDialog(session, frame, "Restart 1", "confirm");

      expect(dialog).toMatch(/Skipped: .*otel-apps\/checkout \(Already injected\.\)/);
      await notificationMatching(session, frame, /Restarted 1 of 1/);
      await leaveNothingBehind(session, frame, "opentelemetry-overview", "opentelemetry");

      await untilCluster(
        "late-agent's new pods with the agent",
        () => settled("otel-late/late-agent", true),
        10 * 60_000,
      );
      expect(await uids()).toEqual(checkout);
      expect(await shows("otel-late/late-agent", "Injected")).toBe(true);
    } finally {
      await leaveNothingBehind(session, frame, "opentelemetry-overview", "opentelemetry");
      await putBack("otel-late/late-agent");
    }

    expect(await shows("otel-late/late-agent", "Restart needed")).toBe(true);
  });
});
