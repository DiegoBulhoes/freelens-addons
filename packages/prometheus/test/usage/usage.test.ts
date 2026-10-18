import { describe, expect, it } from "vitest";
import { hostListOf } from "../../src/renderer/api/shared/host-links";
import { parseTargets } from "../../src/renderer/api/shared/prometheus-api";
import { cpuCores, quantityBytes } from "../../src/renderer/api/shared/units";
import {
  chartNote,
  chartQueries,
  describeMixedClusters,
  describeUsageState,
  describeVolumes,
  diskAttention,
  failedAnswer,
  hasUsageData,
  instanceToNode,
  NODE_CHARTS,
  nodeKeyOf,
  nodeRows,
  POD_METRIC_IDS,
  POD_METRICS,
  podResources,
  podRows,
  podValues,
  ratioOf,
  topPods,
  type UsageMetrics,
  usageState,
  usageVerdict,
} from "../../src/renderer/api/usage/usage";
import {
  named,
  nodes,
  pods,
  pvcs,
  targetsBody,
  usageItem,
  usageMetrics,
  variant,
} from "../support/fixtures";

const metrics = () => usageMetrics() as UsageMetrics;
const NODE = "freelens-addons-dev";

describe("quantities", () => {
  it("CPU in cores", () => {
    expect(cpuCores("16")).toBe(16);
    expect(cpuCores("50m")).toBe(0.05);
    expect(cpuCores("250u")).toBeCloseTo(0.00025);
    expect(cpuCores("1e3n")).toBeCloseTo(0.000001);
    expect(cpuCores("lots")).toBeUndefined();
    expect(cpuCores(undefined)).toBeUndefined();
  });

  it("memory and storage in bytes", () => {
    expect(quantityBytes("192Mi")).toBe(192 * 2 ** 20);
    expect(quantityBytes("23755688Ki")).toBe(23755688 * 1024);
    expect(quantityBytes("1911266929190")).toBe(1911266929190);
    expect(quantityBytes("1G")).toBe(1e9);
    expect(quantityBytes("1e3")).toBe(1000);
    expect(quantityBytes("1ki")).toBeUndefined();
    expect(quantityBytes("1Mb")).toBeUndefined();
  });
});

describe("node rows", () => {
  it("the dev node, from node-exporter, with nothing to flag", () => {
    const [row] = nodeRows(nodes(), metrics(), "node");

    expect(row).toEqual({
      name: NODE,
      cpu: { used: 1.8517777777777775, total: 16, ratio: 1.8517777777777775 / 16 },
      memory: { used: 14337323008, total: 24325824512, ratio: 14337323008 / 24325824512 },
      disk: {
        used: 837593767936,
        total: 2011859927040,
        ratio: 837593767936 / 2011859927040,
        device: "/dev/mapper/ubuntu--vg-ubuntu--lv",
      },
      diskRead: 24669934.93333333,
      diskWritten: 218405683.2,
      netRx: 6799071.122222221,
      netTx: 78245.66666666666,
      pressure: [],
      attention: [],
    });
  });

  it("without series, still listed, sized from the node's capacity, with no data", () => {
    const [row] = nodeRows(nodes(), {}, "node");

    expect(row?.cpu).toEqual({ used: undefined, total: 16, ratio: undefined });
    expect(row?.memory.total).toBe(23755688 * 1024);
    expect(row?.disk).toEqual({});
    expect(row?.netRx).toBeUndefined();
  });

  it("by instance, mapped through the node's InternalIP", () => {
    const exporter = parseTargets(targetsBody()).find((target) =>
      target.scrapePool.startsWith("podMonitor/monitoring/node-exporter"),
    );
    const byInstance = metrics();

    for (const series of byInstance.nodeCpuUsed?.data?.result ?? []) {
      series.metric = { instance: exporter?.labels.instance };
    }

    expect(nodeRows(nodes(), byInstance, "instance")[0]?.cpu.used).toBe(1.8517777777777775);
    expect(instanceToNode(exporter?.labels.instance, nodes())).toBe(NODE);
    expect(instanceToNode(NODE, nodes())).toBe(NODE);
    expect(instanceToNode("[2001:db8::1]:9100", nodes())).toBeUndefined();
    expect(instanceToNode(undefined, nodes())).toBeUndefined();
  });

  it("flags kubelet pressure, high CPU and memory, and a nearly full disk", () => {
    const pressed = nodes().map((node) =>
      variant(node, (data) => {
        const memory = data.status?.conditions?.find((each) => each.type === "MemoryPressure");

        if (memory) memory.status = "True";
      }),
    );
    const full = metrics();

    full.nodeCpuCores = full.nodeCpuUsed;
    full.nodeMemoryTotal = full.nodeMemoryUsed;
    full.nodeFsSize = full.nodeFsUsed;

    expect(nodeRows(pressed, full, "node")[0]?.attention).toEqual([
      { tone: "critical", label: "Node pressure", reason: "The kubelet reports MemoryPressure" },
      { tone: "warning", label: "Node pressure", reason: "In use: CPU 100%, memory 100%" },
      {
        tone: "critical",
        label: "Disk nearly full",
        reason: "/dev/mapper/ubuntu--vg-ubuntu--lv is 100% full",
      },
    ]);
  });

  it("names the fullest disk without a device label by its mount point, or generically", () => {
    const unnamed = metrics();

    for (const key of ["nodeFsUsed", "nodeFsSize"] as const) {
      for (const series of unnamed[key]?.data?.result ?? [])
        series.metric = { node: series.metric.node };
    }
    unnamed.nodeFsSize = unnamed.nodeFsUsed;

    expect(nodeRows(nodes(), unnamed, "node")[0]?.attention[0]?.reason).toBe(
      "The fullest filesystem is 100% full",
    );
  });
});

describe("node rows from sparse answers", () => {
  it("a node without status, a filesystem without its used series, an empty node label", () => {
    const bare = nodes().map((node) =>
      variant(node, (data) => {
        delete data.status;
      }),
    );
    const sizeOnly = metrics();

    delete sizeOnly.nodeFsUsed;

    const [row] = nodeRows(bare, sizeOnly, "node");

    expect(row).toMatchObject({
      pressure: [],
      cpu: { total: 16 },
      disk: { used: undefined, total: 2011859927040 },
    });
    expect(nodeRows(bare, {}, "node")[0]?.cpu.total).toBeUndefined();
    expect(nodeKeyOf("kubernetes_node", nodes())({ kubernetes_node: "" })).toBeUndefined();
  });

  it("keeps the fuller of two filesystems", () => {
    const two = metrics();

    for (const key of ["nodeFsUsed", "nodeFsSize"] as const) {
      const [series] = two[key]?.data?.result ?? [];

      if (series) {
        two[key]?.data?.result?.push({
          metric: { ...series.metric, device: "/dev/half" },
          values: series.values.map(([t, v]) => [
            t,
            String(key === "nodeFsSize" ? Number(v) : Number(v) * 2),
          ]),
        });
      }
    }

    expect(nodeRows(nodes(), two, "node")[0]?.disk.device).toBe("/dev/half");
  });
});

describe("disk thresholds", () => {
  it("warn from 85% and turn critical at 95%", () => {
    expect(diskAttention(0.84, "x")).toBeUndefined();
    expect(diskAttention(undefined, "x")).toBeUndefined();
    expect(diskAttention(0.85, "x")?.tone).toBe("warning");
    expect(diskAttention(0.95, "x")?.tone).toBe("critical");
  });
});

describe("pod rows", () => {
  const rowOf = (rows: ReturnType<typeof podRows>, key: string) =>
    rows.find((row) => row.key === key);

  it("one per pod that exists; series of pods that are gone are left out", () => {
    const withGone = metrics();
    const [series] = withGone.podMemory?.data?.result ?? [];

    if (series) {
      withGone.podMemory?.data?.result?.push({
        ...series,
        metric: { ...series.metric, pod: "gone-0" },
      });
    }

    const rows = podRows(pods(), withGone, pvcs());

    expect(rows).toHaveLength(pods().length);
    expect(rows.some((row) => row.name === "gone-0")).toBe(false);
  });

  it("the seed Prometheus: usage, requests and limits, and its volume", () => {
    const row = rowOf(podRows(pods(), metrics(), pvcs()), "monitoring/prometheus-seed-0");

    expect(row).toMatchObject({
      node: NODE,
      hostNetwork: false,
      cpu: { used: 0.007977644444444444, request: expect.closeTo(0.06), limit: undefined },
      memory: { used: 330571776, request: (192 + 50) * 2 ** 20, limit: (768 + 50) * 2 ** 20 },
      netRx: 46269.08888888888,
      attention: [],
    });
    expect(row?.pvcs).toEqual([
      {
        name: "prometheus-seed-db-prometheus-seed-0",
        used: 735315976192,
        total: 2011859927040,
        ratio: 735315976192 / 2011859927040,
      },
    ]);
  });

  it("sums up the volumes as the fullest one's share", () => {
    const row = podRows(pods(), metrics(), pvcs()).find(
      (each) => each.key === "monitoring/prometheus-seed-0",
    );
    const [volume] = row?.pvcs ?? [];

    expect(describeVolumes(row?.pvcs ?? [])).toBe(`${Math.round((volume?.ratio ?? 0) * 100)}%`);
    expect(
      describeVolumes(
        volume
          ? [volume, { ...volume, name: "full", ratio: 0.97 }, { ...volume, ratio: undefined }]
          : [],
      ),
    ).toBe("97%");
    expect(describeVolumes(volume ? [{ ...volume, ratio: undefined }] : [])).toBe("no data");
    expect(describeVolumes([])).toBe("—");
  });

  it("a host-network pod shows no network: its counters are the node's", () => {
    const row = rowOf(podRows(pods(), metrics()), "monitoring/node-exporter-zwpw6");

    expect(row?.hostNetwork).toBe(true);
    expect(row?.netRx).toBeUndefined();
    expect(row?.netTx).toBeUndefined();
    expect(row?.memory.used).toBe(21237760);
  });

  it("a pod with no requests or limits has none", () => {
    const provisioner = named(pods(), "kube-system/local-path-provisioner-77b9867795-66hn2");

    expect(podResources(provisioner, "cpu")).toEqual({ request: undefined, limit: undefined });
  });

  it("flags the container nearest its own limit, even when the pod's sum is far below", () => {
    const tight = pods().map((pod) =>
      variant(pod, (data) => {
        for (const container of data.spec?.containers ?? []) {
          if (container.name === "prometheus" && container.resources?.limits)
            container.resources.limits.memory = "313Mi";
          if (container.name === "config-reloader" && container.resources?.limits)
            container.resources.limits.memory = "10Gi";
          if (container.name === "prometheus-operator" && container.resources?.limits)
            container.resources.limits.cpu = "1m";
        }
      }),
    );
    const rows = podRows(tight, metrics());
    const seed = rowOf(rows, "monitoring/prometheus-seed-0");

    expect(ratioOf(seed?.memory.used, seed?.memory.limit)).toBeLessThan(0.1);
    expect(seed?.attention).toEqual([
      {
        tone: "critical",
        label: "Near memory limit",
        reason: "Container prometheus is at 98% of its memory limit: the kernel kills it at 100%",
      },
    ]);
    expect(
      rowOf(rows, "prometheus-operator/prometheus-operator-65bdfd9bf9-wlbsw")?.attention,
    ).toEqual([
      {
        tone: "warning",
        label: "Near CPU limit",
        reason:
          "Container prometheus-operator is at 412% of its CPU limit: it is throttled at 100%",
      },
    ]);
  });

  it("counts a native sidecar in requests, limits and the attention check", () => {
    const sidecar = pods().map((pod) =>
      variant(pod, (data) => {
        if (pod.getName() !== "prometheus-seed-0" || !data.spec) return;

        const reloader = data.spec.containers?.find((each) => each.name === "config-reloader");

        data.spec.containers = data.spec.containers?.filter((each) => each !== reloader);
        if (reloader?.resources?.limits) {
          reloader.restartPolicy = "Always";
          reloader.resources.limits.memory = "7Mi";
          data.spec.initContainers = [...(data.spec.initContainers ?? []), reloader];
        }
      }),
    );
    const seed = rowOf(podRows(sidecar, metrics()), "monitoring/prometheus-seed-0");

    expect(seed?.memory).toMatchObject({
      request: (192 + 50) * 2 ** 20,
      limit: (768 + 7) * 2 ** 20,
    });
    expect(seed?.attention[0]?.reason).toBe(
      "Container config-reloader is at 114% of its memory limit: the kernel kills it at 100%",
    );
  });

  it("a pod without a spec, and series without a namespace", () => {
    const bare = pods().map((pod) =>
      variant(pod, (data) => {
        delete data.spec;
      }),
    );
    const anonymous = metrics();

    for (const key of ["podCpu", "pvcUsed"] as const) {
      for (const series of anonymous[key]?.data?.result ?? []) delete series.metric.namespace;
    }

    expect(rowOf(podRows(bare, metrics()), "monitoring/prometheus-seed-0")).toMatchObject({
      cpu: { request: undefined, limit: undefined },
      pvcs: [],
      hostNetwork: false,
    });
    expect(
      rowOf(podRows(pods(), anonymous, pvcs()), "monitoring/prometheus-seed-0")?.cpu.used,
    ).toBeUndefined();
    expect(
      rowOf(podRows(pods(), anonymous, pvcs()), "monitoring/prometheus-seed-0")?.pvcs[0]?.used,
    ).toBeUndefined();
  });

  it("a volume's capacity falls back to the claim's, and a full one is flagged", () => {
    const withoutCapacity = metrics();

    delete withoutCapacity.pvcCapacity;

    const [pvc] =
      rowOf(podRows(pods(), withoutCapacity, pvcs()), "monitoring/prometheus-seed-0")?.pvcs ?? [];

    expect(pvc?.total).toBe(2 ** 30);
    expect(
      rowOf(podRows(pods(), withoutCapacity, pvcs()), "monitoring/prometheus-seed-0")?.attention[0]
        ?.label,
    ).toBe("Disk nearly full");
    expect(rowOf(podRows(pods(), {}, []), "monitoring/prometheus-seed-0")?.pvcs).toEqual([
      {
        name: "prometheus-seed-db-prometheus-seed-0",
        used: undefined,
        total: undefined,
        ratio: undefined,
      },
    ]);
  });
});

describe("whether a Prometheus answers", () => {
  it("ready with node series, nodes missing with only pod series, not configured with nothing", () => {
    const probe = usageItem("nodeLabelNode").response;
    const podCpu = usageItem("podCpu").response;

    expect(usageState([probe, {}], podCpu)).toBe("ready");
    expect(usageState([{}, usageItem("nodeLabelKubernetesNode").response], podCpu)).toBe("ready");
    expect(usageState([{}, {}], podCpu)).toBe("no-node-metrics");
    expect(usageState([{}, {}, undefined], {})).toBe("not-configured");
    expect(describeUsageState("not-configured")).toBe(
      "No answer from a Prometheus for this cluster. Check the cluster's Settings → Metrics, then press Refresh.",
    );
    expect(describeUsageState("no-node-metrics")).toBe(
      "No node-exporter series reach this cluster's Prometheus, so the Nodes page has no data.",
    );
    expect(describeUsageState("ready")).toBeUndefined();
  });
});

describe("a Prometheus shared by clusters", () => {
  it("is named only when its series carry more than one cluster label", () => {
    expect(describeMixedClusters([])).toBeUndefined();
    expect(describeMixedClusters(["dev"])).toBeUndefined();
    expect(describeMixedClusters(["dev", "prod"])).toMatch(
      /^This Prometheus holds series from 2 clusters \(dev, prod\).*prom-label-proxy/,
    );
  });
});

describe("a chart with no line", () => {
  const nodeCpu = usageItem("nodeCpuUsed").response;

  it("says it is asking until the first answer", () => {
    expect(chartNote([undefined], false)).toBe("Asking Prometheus.");
  });

  it("names the refusal, from a thrown read or the host's empty answer", () => {
    expect(chartNote([nodeCpu, { status: "error", error: "No answer in 20s" }], true)).toBe(
      "Prometheus did not answer: No answer in 20s",
    );
    expect(chartNote([{}], true)).toBe("Prometheus did not answer.");
    expect(failedAnswer(nodeCpu)).toBe(false);
    expect(failedAnswer(undefined)).toBe(false);
  });

  it("says when Prometheus answered with no series", () => {
    const empty = usageItem("nodeCpuUsed").response;

    if (empty.data) empty.data.result = [];

    expect(chartNote([empty, undefined], true)).toBe("No series in this window.");
  });
});

describe("the last values per pod", () => {
  it("are built once per answer, not on every pod event", () => {
    const answer = metrics();

    expect(podValues(answer)).toBe(podValues(answer));
    expect(podValues(metrics())).not.toBe(podValues(answer));
    expect(podValues(answer).memory.get("monitoring/prometheus-seed-0")).toBe(330571776);
  });
});

describe("charts", () => {
  it("ranks pods by one measure, busiest first, leaving out those without it", () => {
    const rows = podRows(pods(), metrics(), pvcs());
    const top = topPods(rows, "memory", 3);

    expect(top.map((row) => row.key)).toEqual([
      "monitoring/prometheus-seed-0",
      "prometheus-operator/prometheus-operator-65bdfd9bf9-wlbsw",
      "otel-collectors/scraper-collector-0",
    ]);

    const network = topPods(rows, "netRx", 100);

    expect(network.some((row) => row.hostNetwork)).toBe(false);
    expect(network.map((row) => row.netRx)).toEqual(
      network.map((row) => row.netRx).sort((a = 0, b = 0) => b - a),
    );
    expect(topPods(podRows(pods(), {}), "cpu", 10)).toEqual([]);
  });

  it("names each measure's query, and the node charts' queries once each", () => {
    expect(POD_METRIC_IDS.map((id) => POD_METRICS[id].query)).toEqual([
      "podCpu",
      "podMemory",
      "podNetRx",
      "podNetTx",
      "podDiskIo",
    ]);
    expect(chartQueries(NODE_CHARTS)).toEqual([
      "nodeCpuUsed",
      "nodeMemoryUsed",
      "nodeFsUsed",
      "nodeNetRx",
      "nodeNetTx",
    ]);
  });
});

describe("the State cell", () => {
  it("names the worst attention, else no data or fine", () => {
    const warning = { tone: "warning" as const, label: "Near CPU limit", reason: "a" };
    const critical = { tone: "critical" as const, label: "Near memory limit", reason: "b" };

    expect(usageVerdict([warning, critical], true, "pod")).toBe(critical);
    expect(usageVerdict([], false, "pod").label).toBe("No data");
    expect(usageVerdict([], true, "node")).toEqual({
      tone: "ok",
      label: "Fine",
      reason: "Below every threshold",
    });
  });

  it("says which exporter is missing when a row has no data", () => {
    expect(usageVerdict([], false, "pod").reason).toBe(
      "No cAdvisor series for this pod: the kubelet is not scraped, or the pod is too new",
    );
    expect(usageVerdict([], false, "node").reason).toMatch(/^No node-exporter series/);
  });

  it("counts a row with only memory as having data, as its drawer does", () => {
    const onlyMemory = metrics();

    delete onlyMemory.nodeCpuUsed;
    delete onlyMemory.podCpu;

    const [node] = nodeRows(nodes(), onlyMemory, "node");
    const seed = podRows(pods(), onlyMemory, pvcs()).find(
      (each) => each.key === "monitoring/prometheus-seed-0",
    );

    expect([node?.cpu.used, seed?.cpu.used]).toEqual([undefined, undefined]);
    expect(node && hasUsageData(node)).toBe(true);
    expect(seed && hasUsageData(seed)).toBe(true);
    expect(node && usageVerdict(node.attention, hasUsageData(node), "node").label).toBe("Fine");

    const [bare] = nodeRows(nodes(), {}, "node");

    expect(bare && hasUsageData(bare)).toBe(false);
  });

  it("links to the host's lists by name", () => {
    expect(hostListOf("Node", "freelens-addons-dev")).toBe("/nodes?search=freelens-addons-dev");
    expect(hostListOf("Pod", "a b")).toBe("/pods?search=a%20b");
  });
});
