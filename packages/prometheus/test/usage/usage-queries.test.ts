import { describe, expect, it } from "vitest";

import {
  CLUSTER_PROBE,
  clustersFrom,
  currentRange,
  DEFAULT_WINDOW,
  describePeriod,
  describeRefresh,
  editorRange,
  forPods,
  fromLocalInput,
  isFirstAsk,
  isFixed,
  metricsKey,
  namespaceMatcher,
  nodeLabelFrom,
  nodeQueries,
  PROBE_RETRIES,
  PROBE_RETRY_MS,
  parseRange,
  periodCurrent,
  periodKey,
  periodRange,
  periodSeconds,
  podQueries,
  probeQuery,
  probeRetryIn,
  promDuration,
  rangeFor,
  rateWindow,
  refreshFor,
  stepFor,
  toLocalInput,
  usageSubline,
  WINDOWS,
} from "../../src/renderer/api/usage/usage-queries";
import { usageItem, usageItems } from "../support/fixtures";

describe("the queries", () => {
  it("are the ones the export ran, for the node label and a 60s step", () => {
    const built: Record<string, string> = {
      ...nodeQueries("node", rateWindow(60)),
      ...podQueries(rateWindow(60)),
      nodeLabelNode: probeQuery("node"),
      nodeLabelKubernetesNode: probeQuery("kubernetes_node"),
    };

    for (const item of usageItems()) {
      expect([item.key, built[item.key]]).toEqual([item.key, item.query]);
    }
    expect(Object.keys(built).sort()).toEqual(
      usageItems()
        .map((item) => item.key)
        .sort(),
    );
  });

  it("group by whichever label names the node", () => {
    const queries = nodeQueries("kubernetes_node", "20m");

    expect(queries.nodeCpuUsed).toBe(
      'sum by(kubernetes_node)(rate(node_cpu_seconds_total{mode!~"idle|iowait|steal"}[20m]))',
    );
    expect(queries.nodeFsSize).toMatch(/^max by\(kubernetes_node,device\)/);
  });

  it("can be narrowed to chosen pods", () => {
    expect(
      forPods(podQueries("2m").podMemory, [{ namespace: "monitoring", name: "prometheus-seed-0" }]),
    ).toBe(
      'sum by(namespace,pod)(container_memory_working_set_bytes{container!="",container!="POD",image!="",namespace=~"monitoring",pod=~"prometheus-seed-0"})',
    );
    expect(forPods("sum(up{})", [{ namespace: "a.b", name: "c" }])).toBe(
      'sum(up{namespace=~"a\\\\.b",pod=~"c"})',
    );

    const seed = { namespace: "monitoring", name: "prometheus-seed-0" };
    const operator = { namespace: "prometheus-operator", name: "prometheus-operator-0" };

    expect(forPods("sum(up{})", [seed, operator])).toBe(forPods("sum(up{})", [operator, seed]));
  });
});

describe("the namespace scope", () => {
  const all = ["kube-system", "monitoring", "prom-apps"];

  it("narrows every pod query, volumes included, when it is narrower than the cluster", () => {
    const matcher = namespaceMatcher(["prom-apps", "monitoring", "monitoring"], all);

    expect(matcher).toBe('namespace=~"monitoring|prom-apps"');

    const scoped = podQueries("2m", matcher);

    for (const query of Object.values(scoped)) {
      expect(query.match(/\{[^}]*\}/g)?.every((each) => each.includes(matcher ?? ""))).toBe(true);
    }
    expect(scoped.pvcUsed).toBe(
      'sum by(namespace,persistentvolumeclaim)(kubelet_volume_stats_used_bytes{namespace=~"monitoring|prom-apps"})',
    );
    expect(scoped.podNetRx).toBe(
      'sum by(namespace,pod)(rate(container_network_receive_bytes_total{pod!="",interface!="lo",namespace=~"monitoring|prom-apps"}[2m]))',
    );
  });

  it("asks the cluster-wide queries, as exported, when the scope is every namespace", () => {
    expect(namespaceMatcher(all, all)).toBeUndefined();
    expect(namespaceMatcher([], all)).toBeUndefined();
    expect(namespaceMatcher(["monitoring"], [])).toBeUndefined();
    expect(podQueries("2m", undefined)).toEqual(podQueries("2m"));
    expect(namespaceMatcher(["a.b"], ["a.b", "c"])).toBe('namespace=~"a\\\\.b"');
  });
});

describe("the key of a read", () => {
  const { end: now } = usageItem("nodeCpuUsed");
  const queries = { podCpu: podQueries("2m").podCpu };

  it("keeps the current figures across rolling windows, which all end now", () => {
    expect(metricsKey(queries, { id: "1h" }, "current")).toBe(
      metricsKey(queries, { id: "7d" }, "current"),
    );
    expect(metricsKey(queries, { start: now - 600, end: now }, "current")).not.toBe(
      metricsKey(queries, { start: now - 900, end: now - 300 }, "current"),
    );
    expect(metricsKey(queries, { start: now - 600, end: now }, "current")).toBe(
      metricsKey(queries, { start: now - 900, end: now }, "current"),
    );
  });

  it("asks a chart again for each window, and current and chart reads apart", () => {
    expect(metricsKey(queries, { id: "1h" }, "chart")).not.toBe(
      metricsKey(queries, { id: "7d" }, "chart"),
    );
    expect(metricsKey(queries, { id: "1h" }, "chart")).not.toBe(
      metricsKey(queries, { id: "1h" }, "current"),
    );
    expect(metricsKey({ other: "up" }, { id: "1h" }, "current")).not.toBe(
      metricsKey(queries, { id: "1h" }, "current"),
    );
  });
});

describe("asking now", () => {
  const range = currentRange(usageItem("nodeCpuUsed").end * 1000);

  it("is said until the probe and every read have a first answer", () => {
    expect(isFirstAsk(false, [])).toBe(true);
    expect(isFirstAsk(true, [{ loading: true }])).toBe(true);
    expect(isFirstAsk(true, [{ range, loading: false }, { loading: false }])).toBe(false);
  });

  it("is not said while a refresh reads again behind the last answer", () => {
    expect(isFirstAsk(true, [{ range, loading: true }])).toBe(false);
  });
});

describe("the node-label probe", () => {
  it("is asked again soon a few times while no label names a node", () => {
    expect(probeRetryIn(false, 0)).toBe(PROBE_RETRY_MS);
    expect(probeRetryIn(false, PROBE_RETRIES - 1)).toBe(PROBE_RETRY_MS);
    expect(probeRetryIn(false, PROBE_RETRIES)).toBeUndefined();
    expect(probeRetryIn(true, 0)).toBeUndefined();
  });
});

describe("a Prometheus shared by clusters", () => {
  const withClusters = (...clusters: (string | undefined)[]) => {
    const response = usageItem("nodeLabelNode").response;
    const [series] = response.data?.result ?? [];

    if (response.data && series) {
      response.data.result = clusters.map((cluster) => ({ ...series, metric: { cluster } }));
    }

    return response;
  };

  it("names each cluster label once, and none when the series carry no such label", () => {
    expect(CLUSTER_PROBE).toBe("count by(cluster)(node_uname_info)");
    expect(clustersFrom(withClusters("prod", "dev", "prod"))).toEqual(["dev", "prod"]);
    expect(clustersFrom(withClusters(undefined))).toEqual([]);
    expect(clustersFrom(usageItem("nodeLabelNode").response)).toEqual([]);
    expect(clustersFrom(undefined)).toEqual([]);
  });
});

describe("ranges and steps", () => {
  it("start on 1h", () => {
    expect(DEFAULT_WINDOW).toBe("1h");
  });

  it("follow the host's step table, with a rate window of two steps and at least 2m", () => {
    expect(
      WINDOWS.map((window) => [
        window.id,
        stepFor(window.seconds),
        rateWindow(stepFor(window.seconds)),
      ]),
    ).toEqual([
      ["5m", 15, "2m"],
      ["15m", 15, "2m"],
      ["30m", 15, "2m"],
      ["1h", 60, "2m"],
      ["6h", 600, "20m"],
      ["24h", 600, "20m"],
      ["7d", 10_800, "6h"],
    ]);
    expect(stepFor(3 * 24 * 3_600)).toBe(3_600);
    expect(stepFor(20 * 24 * 3_600)).toBe(21_600);
    expect(stepFor(60 * 24 * 3_600)).toBe(43_200);
    expect((20 * 365 * 24 * 3_600) / stepFor(20 * 365 * 24 * 3_600)).toBeLessThanOrEqual(11_000);
    expect(promDuration(90)).toBe("90s");
  });

  it("end on the last whole minute, as the export's did", () => {
    const item = usageItem("nodeCpuUsed");
    const range = rangeFor(3_600, item.end * 1000 + 59_000);

    expect(range).toEqual({ start: item.start, end: item.end, step: item.step });
    expect(currentRange(item.end * 1000)).toEqual({
      start: item.end - 300,
      end: item.end,
      step: 60,
    });
  });

  it("a short window ends on its 15s grid, so each refresh moves it", () => {
    const { end } = usageItem("nodeCpuUsed");

    expect(rangeFor(300, end * 1000 + 44_000)).toEqual({
      start: end + 30 - 300,
      end: end + 30,
      step: 15,
    });
  });
});

describe("a period", () => {
  const { end: now } = usageItem("nodeCpuUsed");
  const fixed = { start: now - 7_200, end: now - 3_600 };

  it("is a window that moves with now, or a fixed range", () => {
    expect(isFixed({ id: "15m" })).toBe(false);
    expect(isFixed(fixed)).toBe(true);
    expect(periodSeconds({ id: "15m" })).toBe(900);
    expect(periodSeconds(fixed)).toBe(3_600);
    expect(periodKey({ id: "15m" })).toBe("15m");
    expect(periodKey(fixed)).toBe(`${now - 7_200}-${now - 3_600}`);
  });

  it("charts a fixed range as chosen, and its table shows the range's end", () => {
    expect(periodRange(fixed, now * 1000)).toEqual({ ...fixed, step: 60 });
    expect(periodRange({ id: "1h" }, now * 1000)).toEqual(rangeFor(3_600, now * 1000));
    expect(periodCurrent(fixed, now * 1000)).toEqual(currentRange(fixed.end * 1000));
    expect(periodCurrent({ id: "7d" }, now * 1000)).toEqual(currentRange(now * 1000));
  });

  it("asks again every 15s up to 30m, every minute above, and never when fixed", () => {
    expect(WINDOWS.map((window) => refreshFor({ id: window.id }))).toEqual([
      15_000, 15_000, 15_000, 60_000, 60_000, 60_000, 60_000,
    ]);
    expect(refreshFor(fixed)).toBeUndefined();
    expect(describeRefresh({ id: "5m" })).toBe("Asked again every 15 seconds while shown.");
    expect(describeRefresh({ id: "1h" })).toBe("Asked again every minute while shown.");
    expect(describeRefresh(fixed)).toBe(
      "A fixed range is not asked again until Refresh is pressed.",
    );
  });

  it("says what it covers", () => {
    expect(describePeriod({ id: "30m" })).toBe("the last 30 minutes");
    expect(describePeriod(fixed)).toBe(
      `${toLocalInput(fixed.start).replace("T", " ")} to ${toLocalInput(fixed.end).replace("T", " ")}`,
    );
    expect(usageSubline({ id: "1h" })).toBe(
      "From the Prometheus set in the cluster's Settings → Metrics, over the last 1 hour. Asked again every minute while shown.",
    );
  });
});

describe("the range inputs", () => {
  const { end: now } = usageItem("nodeCpuUsed");
  const local = (minutesAgo: number) => toLocalInput(now - minutesAgo * 60);

  it("run away from UTC, so a UTC slip shows", () => {
    expect(new Date(now * 1000).getTimezoneOffset()).toBe(180);
    expect(toLocalInput(now)).not.toBe(new Date(now * 1000).toISOString().slice(0, 16));
  });

  it("read and write local time to the minute", () => {
    const start = new Date(2026, 9, 12, 0, 10).getTime() / 1000;

    expect(toLocalInput(start)).toBe("2026-10-12T00:10");
    expect(fromLocalInput("2026-10-12T00:10")).toBe(start);
    expect(fromLocalInput("2026-02-30T00:10")).toBeUndefined();
    expect(new Date((fromLocalInput("0050-01-01T00:00") ?? 0) * 1000).getFullYear()).toBe(50);
    expect(fromLocalInput("")).toBeUndefined();
    expect(fromLocalInput(local(30))).toBe(now - 1_800);
  });

  it("make a range from the start to the end, which may be now", () => {
    expect(parseRange(local(30), local(10), now * 1000)).toEqual({
      start: now - 1_800,
      end: now - 600,
    });
    expect(parseRange(local(30), local(0), now * 1000 + 30_000)).toEqual({
      start: now - 1_800,
      end: now,
    });
  });

  it("refuse a missing value, a start after the end, or an end in the future, as the host does", () => {
    expect(parseRange("", local(10), now * 1000)).toEqual({ error: "Pick a start and an end." });
    expect(parseRange("1969-12-01T00:00", local(10), now * 1000)).toEqual({
      error: "The start must be after 1970.",
    });
    expect(parseRange(local(10), local(30), now * 1000)).toEqual({
      error: "The start must be before the end.",
    });
    expect(parseRange(local(30), local(-1), now * 1000 + 30_000)).toEqual({
      error: "The end cannot be in the future.",
    });
  });

  it("reopen with what was typed and why it was refused", () => {
    const typed = { from: local(10), to: local(30), error: "The start must be before the end." };

    expect(editorRange({ id: "1h" }, now * 1000, typed)).toEqual(typed);
  });

  it("start from the window shown, or from the fixed range", () => {
    expect(editorRange({ id: "1h" }, now * 1000 + 20_000)).toEqual({
      from: local(60),
      to: local(0),
    });
    expect(editorRange({ start: now - 600, end: now }, 0)).toEqual({
      from: local(10),
      to: local(0),
    });
  });
});

describe("the node label", () => {
  const probe = (key: string) => usageItem(key).response;

  it("is node in the seed; kubernetes_node answers with an empty label, which does not count", () => {
    expect(
      nodeLabelFrom({
        node: probe("nodeLabelNode"),
        kubernetes_node: probe("nodeLabelKubernetesNode"),
      }),
    ).toBe("node");
    expect(
      nodeLabelFrom({ node: {}, kubernetes_node: probe("nodeLabelKubernetesNode") }),
    ).toBeUndefined();
  });

  it("falls back to kubernetes_node, then instance", () => {
    const renamed = (label: string) => {
      const response = probe("nodeLabelNode");

      for (const series of response.data?.result ?? [])
        series.metric = { [label]: series.metric.node };

      return response;
    };

    expect(nodeLabelFrom({ node: {}, kubernetes_node: renamed("kubernetes_node") })).toBe(
      "kubernetes_node",
    );
    expect(nodeLabelFrom({ node: {}, kubernetes_node: {}, instance: renamed("instance") })).toBe(
      "instance",
    );
  });
});
