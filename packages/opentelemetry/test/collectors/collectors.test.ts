import { describe, expect, it } from "vitest";

import {
  causeFromLog,
  causeKey,
  collectorStatusOf,
} from "../../src/renderer/api/collectors/causes";
import {
  allocatorPodsOf,
  type CollectorRow,
  collectorBases,
  collectorRows,
  crashingPods,
  describeReady,
  instanceLabel,
  isReady,
  judgeCollectors,
  parseSelector,
  podsOfCollector,
  SIDECAR_LABEL,
} from "../../src/renderer/api/collectors/collectors";
import type { CollectorLike, PodLike } from "../../src/renderer/api/shared/types";
import {
  collectorLog,
  collectorNamed,
  collectors,
  exitedCollectorPod,
  NOW,
  podOf,
  pods,
  variant,
} from "../support/fixtures";

const NONE = new Map<string, string>();
const rowsOf = (list: CollectorLike[], podList: PodLike[] = pods(), causes = NONE, now = NOW) =>
  collectorRows(list, podList, causes, now);
const rowOf = (collector: CollectorLike, podList?: PodLike[], now?: number): CollectorRow => {
  const [row] = rowsOf([collector], podList, NONE, now);

  if (!row) throw new Error("no row");

  return row;
};
const gateway = () => collectorNamed("otel-collectors/gateway");
const broken = () => collectorNamed("otel-collectors/broken");
const brokenPod = () => podOf("otel-collectors", "broken");
const allocator = () => collectorNamed("otel-allocator/allocator");
const allocatorPod = () => {
  const found = pods().find((pod) => pod.getName().startsWith("allocator-targetallocator-"));

  if (!found) throw new Error("no allocator pod in the fixture");

  return found;
};
const withoutAllocatorPod = () =>
  pods().filter((pod) => pod.getName() !== allocatorPod().getName());
const countOf = (count = 0) => `${count} restart${count === 1 ? "" : "s"}`;
const restarts = () => countOf(collectorStatusOf(brokenPod())?.restartCount);
const allocatorRestarts = () =>
  countOf(allocatorPod().status?.containerStatuses?.[0]?.restartCount);

describe("the Collectors rows", () => {
  it("puts the crash-looping one first and reads the healthy one's facts", () => {
    const rows = rowsOf(collectors());
    const healthy = rows.find((row) => row.name === "gateway");

    expect(rows[0]?.name).toBe("broken");
    expect(healthy).toMatchObject({
      name: "gateway",
      mode: "deployment",
      replicas: { ready: 1, desired: 1 },
      version: "0.158.0",
      targetAllocator: false,
      metrics: { serviceMonitor: false, prometheusCR: false },
      managementState: "managed",
      verdict: { tone: "ok", label: "Ready", reason: "1 of 1 pod ready." },
    });
    expect(healthy?.image).toMatch(/opentelemetry-collector:0\.158\.0$/);
    expect(describeReady(healthy as CollectorRow)).toBe("1/1");
  });

  it("calls broken crash looping from its pod, though its Ready condition is True", () => {
    const row = rowOf(broken());

    expect(broken().status?.conditions?.[0]).toMatchObject({ type: "Ready", status: "True" });
    expect(row.replicas).toEqual({ ready: 0, desired: 1 });
    expect(row.verdict).toEqual({
      tone: "critical",
      label: "Crash looping",
      reason: `${brokenPod().getName()}: exit code 1 (Error), ${restarts()}; its previous log says why.`,
    });
  });

  it("gives the cause from its previous log once it is read", () => {
    const causes = new Map([[causeKey(brokenPod()), causeFromLog(collectorLog()) ?? ""]]);
    const [row] = rowsOf([broken()], pods(), causes);

    expect(row?.verdict.reason).toBe(
      `invalid configuration: service::pipelines::traces: references exporter "debugg" which is not configured; exit code 1 (Error), ${restarts()}.`,
    );
  });

  it("reads broken as not ready, not crash looping, once its last exit is old", () => {
    const others = pods().filter((pod) => pod.getName() !== brokenPod().getName());

    expect(
      rowOf(broken(), [...others, exitedCollectorPod()], NOW + 24 * 3_600_000).verdict,
    ).toEqual({
      tone: "warning",
      label: "Not ready",
      reason: "0 of 1 pod ready.",
    });
  });

  it("says what a pod that is not ready waits for", () => {
    const waiting = variant(podOf("otel-collectors", "gateway"), (data) => {
      data.status = {
        ...data.status,
        conditions: (data.status?.conditions ?? []).map((each) => ({ ...each, status: "False" })),
        containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
          ...status,
          ready: false,
          state: { waiting: { reason: "ContainerCreating" } },
        })),
      };
    });

    expect(isReady(waiting)).toBe(false);
    expect(rowOf(gateway(), [waiting]).verdict.reason).toBe(
      "0 of 1 pod ready. Waiting: ContainerCreating.",
    );
  });
});

describe("a collector's target allocator", () => {
  it("reads its crash loop on the collector's row, though the collector's pods are ready", () => {
    const row = rowOf(allocator());

    expect(row.replicas).toEqual({ ready: 1, desired: 1 });
    expect(row.allocator?.pods.map((pod) => pod.getName())).toEqual([allocatorPod().getName()]);
    expect(row.pods.map((pod) => pod.getName())).not.toContain(allocatorPod().getName());
    expect(row.verdict).toEqual({
      tone: "warning",
      label: "Target allocator crash looping",
      reason: `${allocatorPod().getName()}: exit code 137 (OOMKilled), ${allocatorRestarts()}; its prometheus receiver gets no targets meanwhile.`,
    });
  });

  it("reads it not ready while its pod waits, and when none runs", () => {
    const creating = variant(allocatorPod(), (data) => {
      data.status = {
        ...data.status,
        containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
          ...status,
          restartCount: 0,
          lastState: {},
          state: { waiting: { reason: "ContainerCreating" } },
        })),
      };
    });

    expect(rowOf(allocator(), [...withoutAllocatorPod(), creating]).verdict).toEqual({
      tone: "warning",
      label: "Target allocator not ready",
      reason:
        "0 of 1 target allocator pod ready, waiting: ContainerCreating; its prometheus receiver gets no targets meanwhile.",
    });
    expect(rowOf(allocator(), withoutAllocatorPod()).verdict.reason).toBe(
      "0 of 1 target allocator pod ready; its prometheus receiver gets no targets meanwhile.",
    );
  });

  it("counts the replicas it asks for", () => {
    const two = variant(allocator(), (data) => {
      data.spec.targetAllocator = { ...data.spec.targetAllocator, replicas: 2 };
    });

    expect(rowOf(two).allocator).toMatchObject({ desired: 2, ready: 0 });
  });

  it("is left alone while the collector itself crashes, which is worse", () => {
    const crashing = variant(allocator(), (data) => {
      data.status = undefined;
    });
    const brokenHere = variant(brokenPod(), (data) => {
      data.metadata.namespace = "otel-allocator";
      data.metadata.labels = {
        ...data.metadata.labels,
        "app.kubernetes.io/instance": "otel-allocator.allocator",
      };
    });

    expect(rowOf(crashing, [allocatorPod(), brokenHere]).verdict.label).toBe("Crash looping");
  });

  it("reads a healthy one as Ready, and none where it is off", () => {
    const scraper = rowOf(collectorNamed("otel-collectors/scraper"));

    expect(scraper.allocator).toMatchObject({ ready: 1, desired: 1, crashes: [] });
    expect(scraper.verdict.label).toBe("Ready");
    expect(rowOf(gateway()).allocator).toBeUndefined();
    expect(allocatorPodsOf(gateway(), pods())).toEqual([]);
  });

  it("matches only its own collector's pods", () => {
    const scraper = allocatorPodsOf(collectorNamed("otel-collectors/scraper"), pods());

    expect(scraper.map((pod) => pod.getName())).toEqual([
      expect.stringMatching(/^scraper-targetallocator-/),
    ]);
  });
});

describe("a collector killed for memory", () => {
  const oomKilled = () =>
    variant(brokenPod(), (data) => {
      data.status = {
        ...data.status,
        containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
          ...status,
          state: { waiting: { reason: "CrashLoopBackOff" } },
          lastState: {
            terminated: { ...status.lastState?.terminated, reason: "OOMKilled", exitCode: 137 },
          },
        })),
      };
    });

  it("says so without reading its log", () => {
    const others = pods().filter((pod) => pod.getName() !== brokenPod().getName());
    const bases = collectorBases(collectors(), [...others, oomKilled()], NOW);

    const killed = judgeCollectors(bases, NONE).find((row) => row.name === "broken");

    expect(crashingPods(bases)).toEqual([]);
    expect(killed?.verdict.reason).toBe(
      `${brokenPod().getName()}: exit code 137 (OOMKilled), ${restarts()}; it ran out of its memory limit.`,
    );
  });
});

describe("the pods whose log is read", () => {
  it("are the crashing collectors' own, never a target allocator's", () => {
    const bases = collectorBases(collectors(), pods(), NOW);

    expect(crashingPods(bases).map((pod) => pod.getName())).toEqual([brokenPod().getName()]);
  });

  it("leave out a target allocator that exits with an error, whose log would be worth a read", () => {
    const erroring = variant(allocatorPod(), (data) => {
      data.status = {
        ...data.status,
        containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
          ...status,
          lastState: {
            terminated: { ...status.lastState?.terminated, reason: "Error", exitCode: 1 },
          },
        })),
      };
    });
    const bases = collectorBases(collectors(), [...withoutAllocatorPod(), erroring], NOW);

    expect(bases.find((base) => base.name === "allocator")?.allocator?.crashes).toHaveLength(1);
    expect(crashingPods(bases).map((pod) => pod.getName())).toEqual([brokenPod().getName()]);
  });
});

describe("a collector's pods", () => {
  it("are chosen by its status selector, so broken's pod is not gateway's", () => {
    expect(podsOfCollector(gateway(), pods()).map((pod) => pod.getName())).toEqual([
      podOf("otel-collectors", "gateway").getName(),
    ]);
  });

  it("leave out its target allocator's pods, which share its instance label", () => {
    const allocated = variant(gateway(), (data) => {
      data.spec.targetAllocator = { ...data.spec.targetAllocator, enabled: true };
    });
    const allocator = variant(podOf("otel-collectors", "gateway"), (data) => {
      data.metadata.name = "gateway-targetallocator-0";
      data.metadata.labels = {
        ...data.metadata.labels,
        "app.kubernetes.io/component": "opentelemetry-targetallocator",
      };
    });
    const row = rowOf(allocated, [...pods(), allocator]);

    expect(row.targetAllocator).toBe(true);
    expect(row.pods.map((pod) => pod.getName())).not.toContain("gateway-targetallocator-0");
    expect(row.replicas).toEqual({ ready: 1, desired: 1 });
  });

  it("are found by the operator's labels before it has written a status", () => {
    const fresh = variant(gateway(), (data) => {
      data.status = undefined;
    });
    const row = rowOf(fresh);

    expect(row.pods).toHaveLength(1);
    expect(row.replicas).toEqual({ ready: 1, desired: 1 });
  });

  it("count a DaemonSet's own pods when there is no status", () => {
    const daemon = variant(gateway(), (data) => {
      data.spec.mode = "daemonset";
      data.spec.replicas = 3;
      data.status = undefined;
    });

    expect(rowOf(daemon).replicas).toEqual({ ready: 1, desired: 1 });
  });

  it("fall back to the labels when the selector is not plain key=value", () => {
    const setBased = variant(gateway(), (data) => {
      data.status = {
        ...data.status,
        scale: { ...data.status?.scale, selector: "app.kubernetes.io/instance in (x)" },
      };
    });

    expect(rowOf(setBased).pods).toHaveLength(1);
  });

  it("are, for a sidecar, the pods labelled with it in any namespace", () => {
    const sidecar = collectorNamed("otel-collectors/sidecar");
    const carrier = podOf("otel-sidecar", "carrier");
    const row = rowOf(sidecar);

    expect(carrier.metadata.labels?.[SIDECAR_LABEL]).toBe(
      instanceLabel("otel-collectors", "sidecar"),
    );
    expect(row.pods.map((pod) => pod.getName())).toEqual([carrier.getName()]);
    expect(row.replicas).toBeUndefined();
    expect(row.verdict).toMatchObject({ tone: "ok", label: "In 1 pod" });
    expect(describeReady(row)).toBe("1 pod");
    expect(
      rowOf(
        sidecar,
        pods().filter((pod) => pod.getNs() !== "otel-sidecar"),
      ).verdict,
    ).toEqual({
      tone: "info",
      label: "In no pod",
      reason: "No pod in the namespaces in scope carries it as a sidecar.",
    });
  });
});

describe("what the operator is told to do", () => {
  it("leaves an unmanaged collector alone, and says so", () => {
    const unmanaged = variant(gateway(), (data) => {
      data.spec.managementState = "unmanaged";
    });

    expect(rowOf(unmanaged).verdict).toMatchObject({ tone: "info", label: "Unmanaged" });
  });

  it("reads the metrics flags as they are set", () => {
    const flagged = variant(gateway(), (data) => {
      data.spec.observability = { metrics: { enableMetrics: true } };
      data.spec.targetAllocator = { enabled: true, prometheusCR: { enabled: true } };
    });

    expect(rowOf(flagged).metrics).toEqual({ serviceMonitor: true, prometheusCR: true });
  });

  it("defaults the mode and the replicas as the operator does", () => {
    const bare = variant(gateway(), (data) => {
      data.spec.mode = undefined;
      data.spec.replicas = undefined;
      data.spec.managementState = undefined;
      data.status = undefined;
    });

    expect(rowOf(bare)).toMatchObject({
      mode: "deployment",
      replicas: { ready: 1, desired: 1 },
      managementState: "managed",
    });
  });
});

describe("the operator's names and selectors", () => {
  it("truncates the instance label as naming.Truncate does, the namespace first", () => {
    expect(instanceLabel("otel-collectors", "gateway")).toBe("otel-collectors.gateway");

    const long = "g".repeat(60);

    expect(instanceLabel("otel-collectors", long)).toBe(`ot.${long}`);
    expect(instanceLabel("otel-collectors", "g".repeat(70))).toBe("g".repeat(62));
  });

  it("reads key=value terms and nothing else", () => {
    expect(parseSelector(gateway().status?.scale?.selector)).toMatchObject({
      "app.kubernetes.io/instance": "otel-collectors.gateway",
      "app.kubernetes.io/component": "opentelemetry-collector",
    });
    expect(parseSelector("a==b")).toEqual({ a: "b" });
    expect(parseSelector("")).toBeUndefined();
    expect(parseSelector(undefined)).toBeUndefined();
    expect(parseSelector("a!=b")).toBeUndefined();
  });
});
