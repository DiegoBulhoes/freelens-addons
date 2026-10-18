import { describe, expect, it } from "vitest";
import {
  AGENT_INIT_CONTAINERS,
  COLLECTOR_CONTAINER,
  GO_SIDECAR,
  injectionOf,
  isBatch,
  isWorkload,
  lastJobOf,
  podsOf,
  podTemplateOf,
  standsAlone,
} from "../../src/renderer/api/coverage/workload-pods";
import type { PodLike } from "../../src/renderer/api/shared/types";
import { podOf, pods, variant, workloadNamed, workloads } from "../support/fixtures";

const names = (list: PodLike[]) => list.map((pod) => pod.getName()).sort();

describe("a workload's pods", () => {
  it("finds the pods of each kind by its owner", () => {
    expect(names(podsOf(workloadNamed("otel-apps/checkout"), pods()))).toEqual([
      podOf("otel-apps", "checkout").getName(),
    ]);
    expect(names(podsOf(workloadNamed("otel-apps/ledger"), pods()))).toEqual(["ledger-0"]);
    expect(names(podsOf(workloadNamed("otel-late/late-agent"), pods()))).toEqual([
      podOf("otel-late", "late-agent").getName(),
    ]);
  });

  it("does not take a DaemonSet's pod for a Deployment whose name it starts with", () => {
    expect(names(podsOf(workloadNamed("otel-late/late"), pods()))).toEqual([
      podOf("otel-late", "late").getName(),
    ]);
  });

  it("keeps both ReplicaSets' pods during a rollout", () => {
    expect(podsOf(workloadNamed("demo/guestbook-ui"), pods())).toHaveLength(2);
  });

  it("gives every pod a controller owns to exactly one workload with a row", () => {
    const owned = pods().filter((pod) =>
      (pod.metadata.ownerReferences ?? []).some((owner) =>
        ["ReplicaSet", "StatefulSet", "DaemonSet", "Job"].includes(owner.kind),
      ),
    );
    const claimed = workloads()
      .filter(standsAlone)
      .flatMap((workload) => podsOf(workload, pods(), workloads()));

    expect(names(claimed)).toEqual(names(owned));
  });

  it("leaves out pods being deleted or finished", () => {
    const checkout = workloadNamed("otel-apps/checkout");
    const pod = podOf("otel-apps", "checkout");
    const deleting = variant(pod, (data) => {
      data.metadata.deletionTimestamp = data.metadata.creationTimestamp;
    });
    const done = variant(pod, (data) => {
      data.status = { ...data.status, phase: "Succeeded" };
    });
    const failed = variant(pod, (data) => {
      data.status = { ...data.status, phase: "Failed" };
    });

    expect(podsOf(checkout, [deleting, done, failed])).toEqual([]);
  });

  it("knows the five workload kinds, two of them batch", () => {
    expect(isWorkload("StatefulSet")).toBe(true);
    expect(isWorkload("CronJob")).toBe(true);
    expect(isWorkload("Job")).toBe(true);
    expect(isWorkload("ReplicaSet")).toBe(false);
    expect(["Deployment", "CronJob", "Job"].map(isBatch)).toEqual([false, true, true]);
  });
});

describe("a batch workload's pods", () => {
  const nightly = () => workloadNamed("otel-batch/nightly");
  const run = () => workloadNamed("otel-batch/nightly-run");

  it("reads a CronJob's pod template from its jobTemplate", () => {
    expect(podTemplateOf(nightly()).metadata?.annotations).toMatchObject({
      "instrumentation.opentelemetry.io/inject-python": "otel-apps/python",
    });
    expect(podTemplateOf(run())).toEqual(run().spec.template);
    expect(
      podTemplateOf(
        variant(nightly(), (data) => {
          data.spec.jobTemplate = {};
        }),
      ),
    ).toEqual({});
    expect(podTemplateOf(workloadNamed("otel-apps/checkout"))).toEqual(
      workloadNamed("otel-apps/checkout").spec.template,
    );
  });

  it("counts a CronJob's pods through its last Job, finished ones included", () => {
    const pod = podOf("otel-batch", "nightly");

    expect(pod.status?.phase).toBe("Succeeded");
    expect(names(podsOf(nightly(), pods(), workloads()))).toEqual([pod.getName()]);
    expect(podsOf(nightly(), pods())).toEqual([]);
    expect(names(podsOf(workloadNamed("otel-batch/migrate"), pods()))).toEqual([
      podOf("otel-batch", "migrate").getName(),
    ]);
  });

  it("takes the newest of a CronJob's Jobs, and none of another's", () => {
    const older = variant(run(), (data) => {
      data.metadata.name = "nightly-older";
      data.metadata.creationTimestamp = "2000-01-01T00:00:00Z";
    });
    const newer = variant(run(), (data) => {
      data.metadata.name = "nightly-newer";
      data.metadata.creationTimestamp = "2999-01-01T00:00:00Z";
    });
    const twin = variant(run(), (data) => {
      data.metadata.name = "nightly-run-2";
    });
    const elsewhere = variant(newer, (data) => {
      data.metadata.ownerReferences = [{ kind: "CronJob", name: "weekly" }];
    });

    expect(lastJobOf(nightly(), [older, run()])?.getName()).toBe("nightly-run");
    expect(lastJobOf(nightly(), [older, newer, run()])?.getName()).toBe("nightly-newer");
    expect(lastJobOf(nightly(), [elsewhere, older])?.getName()).toBe("nightly-older");
    expect(lastJobOf(nightly(), [twin, run()])?.getName()).toBe("nightly-run-2");
  });

  it("gives a row to a Job only when nothing owns it", () => {
    expect(standsAlone(workloadNamed("otel-batch/migrate"))).toBe(true);
    expect(standsAlone(run())).toBe(false);
    expect(standsAlone(nightly())).toBe(true);
  });
});

describe("whether a pod has the agent", () => {
  const agentInit = () => podOf("otel-apps", "checkout").spec?.initContainers?.[0];
  const late = () => podOf("otel-late", "late");

  it("sees Python's init container and the container it set up", () => {
    const { injected, agents, containers } = injectionOf(podOf("otel-apps", "checkout"));

    expect({ injected, agents, containers }).toEqual({
      injected: true,
      agents: ["opentelemetry-auto-instrumentation-python"],
      containers: ["app"],
    });
  });

  it("sees nothing in a pod started before the opt-in", () => {
    expect(injectionOf(late())).toMatchObject({ injected: false, agents: [], containers: [] });
  });

  it("knows Apache's init containers, which share no prefix with the others", () => {
    const apache = variant(late(), (data) => {
      data.spec = {
        ...data.spec,
        initContainers: [{ ...agentInit(), name: "otel-agent-attach-apache" }],
      };
    });

    expect(AGENT_INIT_CONTAINERS).toContain("otel-agent-source-container-clone");
    expect(injectionOf(apache)).toMatchObject({
      injected: true,
      agents: ["otel-agent-attach-apache"],
      containers: [],
    });
  });

  it("counts Go's sidecar as the agent, not as an instrumented container", () => {
    const app = podOf("otel-apps", "checkout").spec?.containers?.[0];
    const go = variant(late(), (data) => {
      data.spec = {
        ...data.spec,
        containers: [...(data.spec?.containers ?? []), { ...app, name: GO_SIDECAR }],
      };
    });

    expect(injectionOf(go)).toMatchObject({ injected: true, agents: [GO_SIDECAR], containers: [] });
  });

  it("counts a pod as injected only with the agent of every language asked for", () => {
    const checkout = podOf("otel-apps", "checkout");

    expect(injectionOf(checkout, ["python"]).injected).toBe(true);
    expect(injectionOf(checkout, ["java"]).injected).toBe(false);
    expect(injectionOf(checkout, ["python", "go"]).injected).toBe(false);
    expect(injectionOf(checkout, ["sdk"]).injected).toBe(true);
    expect(injectionOf(late(), ["sdk"]).injected).toBe(false);
  });

  it("falls back to the node-name env, but never on the collector's own container", () => {
    const envOnly = variant(podOf("otel-apps", "checkout"), (data) => {
      data.spec = { ...data.spec, initContainers: [] };
    });
    const collectorEnv = variant(envOnly, (data) => {
      data.spec = {
        ...data.spec,
        containers: (data.spec?.containers ?? []).map((each) => ({
          ...each,
          name: COLLECTOR_CONTAINER,
        })),
      };
    });

    expect(injectionOf(envOnly)).toMatchObject({ injected: true, agents: [], containers: ["app"] });
    expect(injectionOf(collectorEnv).injected).toBe(false);
  });
});
