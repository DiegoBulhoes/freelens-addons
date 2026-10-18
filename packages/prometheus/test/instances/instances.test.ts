import { describe, expect, it } from "vitest";

import {
  type AlertingRead,
  alertmanagersOf,
  asksAlerting,
  condition,
  describeAlerting,
  type InstanceRow,
  instanceRows,
  isInstanceFilter,
  matchesInstanceFilter,
  mergeAlerting,
} from "../../src/renderer/api/instances/instances";
import {
  alertmanagersPath,
  apiReads,
  proxyPath,
  queryPods,
} from "../../src/renderer/api/instances/query-pods";
import {
  agents,
  alertingReads,
  alertmanagers,
  named,
  pods,
  prometheuses,
  variant,
} from "../support/fixtures";

const rows = () => instanceRows(prometheuses(), agents(), alertmanagers());
const rowOf = (list: InstanceRow[], key: string) => {
  const found = list.find((row) => row.key === key);

  if (!found) throw new Error(`no row ${key}`);

  return found;
};
const seed = () => named(prometheuses(), "monitoring/seed");

describe("instances", () => {
  it("the seed Prometheus and Alertmanager are available", () => {
    const prometheus = rowOf(rows(), "Prometheus/monitoring/seed");

    expect(prometheus.verdict).toEqual({ tone: "ok", label: "Available", reason: "1 of 1 ready" });
    expect(prometheus.alertmanagers).toEqual([
      "monitoring/alertmanager-operated:web",
      "monitoring/alertmanager:web",
    ]);
    expect(prometheus.selects).toEqual([
      "ServiceMonitors: scraper=prometheus",
      "PodMonitors: scraper=prometheus",
      "ScrapeConfigs: scraper=prometheus",
      "Rules: rules=prometheus",
    ]);
    expect(rowOf(rows(), "Alertmanager/monitoring/seed").verdict.label).toBe("Available");
    expect(rowOf(rows(), "Alertmanager/monitoring/seed").selects).toEqual([]);
  });

  it("no-image is not available, with the operator's message", () => {
    expect(rowOf(rows(), "Prometheus/prom-broken/no-image").verdict).toEqual({
      tone: "critical",
      label: "Not available",
      reason: "shard 0: pod prometheus-no-image-0: containers with unready status: [prometheus]",
    });
  });

  it("the attention filter keeps what is not available, and nothing paused", () => {
    expect(
      rows()
        .filter((row) => matchesInstanceFilter(row, "attention"))
        .map((row) => row.key),
    ).toEqual(["Prometheus/prom-broken/no-image"]);
    expect(rows().filter((row) => matchesInstanceFilter(row, undefined))).toHaveLength(4);
    expect(isInstanceFilter("attention")).toBe(true);
    expect(isInstanceFilter("down")).toBe(false);
    expect(isInstanceFilter(undefined)).toBe(false);
  });

  it("the agent is paused, whatever its conditions say", () => {
    const agent = rowOf(rows(), "PrometheusAgent/monitoring/agent");

    expect(agent.paused).toBe(true);
    expect(agent.verdict.label).toBe("Paused");
    expect(agent.selects).toHaveLength(3);
  });

  it("Degraded, not reconciled, and no conditions yet", () => {
    const withAvailable = (status: string, message = "") =>
      variant(seed(), (data) => {
        const available = data.status?.conditions?.find((each) => each.type === "Available");

        if (available) Object.assign(available, { status, message, reason: "" });
      });
    const notReconciled = variant(seed(), (data) => {
      const reconciled = data.status?.conditions?.find((each) => each.type === "Reconciled");

      if (reconciled) Object.assign(reconciled, { status: "False", message: "", reason: "" });
    });
    const silent = variant(seed(), (data) => {
      if (data.status) data.status.conditions = [];
    });
    const verdictOf = (object: ReturnType<typeof seed>) =>
      instanceRows([object], [], [])[0]?.verdict;

    expect(verdictOf(withAvailable("Degraded"))).toMatchObject({
      tone: "warning",
      reason: "1 of 1 ready",
    });
    expect(verdictOf(withAvailable("Degraded", "shard 1 down"))?.reason).toBe("shard 1 down");
    expect(verdictOf(withAvailable("False"))?.reason).toBe("1 of 1 ready");
    expect(verdictOf(notReconciled)).toMatchObject({
      label: "Not reconciled",
      reason: "The operator could not apply its spec",
    });
    expect(verdictOf(silent)?.label).toBe("Unknown");
    expect(condition(silent, "Available")).toBeUndefined();
  });

  it("counts replicas times shards", () => {
    const sharded = variant(seed(), (data) => {
      data.spec.shards = 2;
      data.spec.replicas = 2;
    });

    expect(instanceRows([sharded], [], [])[0]).toMatchObject({ desired: 4, shards: 2, ready: 1 });
  });

  it("defaults replicas and shards to one, and reads no status as nothing ready", () => {
    const bare = variant(seed(), (data) => {
      delete data.spec.replicas;
      delete data.spec.shards;
      delete data.status;
    });

    expect(instanceRows([bare], [], [])[0]).toMatchObject({
      desired: 1,
      shards: 1,
      ready: 0,
      shardStatuses: [],
    });
    expect(queryPods(bare, "Prometheus", pods()).pods).toHaveLength(1);
  });

  it("names an Alertmanager in its own namespace when the reference has none", () => {
    const local = variant(seed(), (data) => {
      data.spec.alerting = { alertmanagers: [{ name: "alertmanager-operated" }] };
    });

    expect(alertmanagersOf(local)).toEqual(["monitoring/alertmanager-operated"]);
    expect(alertmanagersOf(named(prometheuses(), "prom-broken/no-image"))).toEqual([]);
  });
});

describe("where a Prometheus sends its alerts", () => {
  const withAlerting = (reads: AlertingRead[]) =>
    instanceRows(prometheuses(), agents(), alertmanagers(), reads);
  const ACTIVE = "http://198.51.100.10:9093/api/v2/alerts";

  it("the seed found the Alertmanager behind alertmanager-operated, and stays available", () => {
    const row = rowOf(withAlerting(alertingReads()), "Prometheus/monitoring/seed");

    expect(row.alerting).toEqual({ source: "Prometheus/monitoring/seed", active: [ACTIVE] });
    expect(row.verdict.label).toBe("Available");
    expect(describeAlerting(row)).toBe(ACTIVE);
  });

  it("warns when it discovered none, since its alerts reach nobody", () => {
    const none = alertingReads().map((read) => ({ ...read, active: [] }));
    const row = rowOf(withAlerting(none), "Prometheus/monitoring/seed");

    expect(row.verdict).toEqual({
      tone: "warning",
      label: "No Alertmanager",
      reason:
        "Sends to no Alertmanager: none discovered behind monitoring/alertmanager-operated:web, monitoring/alertmanager:web",
    });
    expect(matchesInstanceFilter(row, "attention")).toBe(true);
    expect(describeAlerting(row)).toBe("No Alertmanager discovered");
    expect(describeAlerting({ ...row, alerting: { source: row.key } })).toBe(
      "No Alertmanager discovered",
    );
  });

  it("a worse state wins, and a read that failed or has not landed leaves the state alone", () => {
    const notAvailable = variant(seed(), (data) => {
      const available = data.status?.conditions?.find((each) => each.type === "Available");

      if (available) Object.assign(available, { status: "False" });
    });
    const none = alertingReads().map((read) => ({ ...read, active: [] }));
    const refused = [{ source: "Prometheus/monitoring/seed", error: "403 Forbidden" }];

    expect(instanceRows([notAvailable], [], [], none)[0]?.verdict.label).toBe("Not available");

    const failed = rowOf(withAlerting(refused), "Prometheus/monitoring/seed");

    expect(failed.verdict.label).toBe("Available");
    expect(describeAlerting(failed)).toBe("Not read: 403 Forbidden");
    expect(describeAlerting(rowOf(rows(), "Prometheus/monitoring/seed"))).toBe("Not read yet");

    const paused = variant(seed(), (data) => {
      data.spec.paused = true;
    });

    expect(describeAlerting(instanceRows([paused], [], [])[0] as InstanceRow)).toBe(
      "Not read: it is paused",
    );
  });

  it("is not asked of a Prometheus without alerting, an agent or an Alertmanager", () => {
    const all = withAlerting(alertingReads());
    const paused = variant(seed(), (data) => {
      data.spec.paused = true;
    });

    expect(asksAlerting(seed())).toBe(true);
    expect(asksAlerting(paused)).toBe(false);
    expect(asksAlerting(named(prometheuses(), "prom-broken/no-image"))).toBe(false);

    const stray = withAlerting([
      { source: "Prometheus/prom-broken/no-image", active: [] },
      { source: "PrometheusAgent/monitoring/agent", active: [] },
    ]);

    expect(rowOf(stray, "Prometheus/prom-broken/no-image").alerting).toBeUndefined();
    expect(rowOf(stray, "PrometheusAgent/monitoring/agent").alerting).toBeUndefined();
    expect(rowOf(stray, "Prometheus/prom-broken/no-image").verdict.label).not.toBe(
      "No Alertmanager",
    );

    expect(rowOf(all, "Prometheus/prom-broken/no-image").alerting).toBeUndefined();
    expect(describeAlerting(rowOf(all, "Prometheus/prom-broken/no-image"))).toBeUndefined();
    expect(describeAlerting(rowOf(all, "PrometheusAgent/monitoring/agent"))).toBeUndefined();
    expect(describeAlerting(rowOf(all, "Alertmanager/monitoring/seed"))).toBeUndefined();
  });

  it("across shards, the one that found fewest stands; one left unread makes it unknown", () => {
    const [read] = alertingReads();
    const active = read?.active ?? [];

    expect(active).toHaveLength(1);
    expect(mergeAlerting("s", [{ active }, { active: [] }])).toEqual({ source: "s", active: [] });
    expect(mergeAlerting("s", [{ active }, {}])).toEqual({ source: "s", active: [] });
    expect(mergeAlerting("s", [{ active: [...active, ...active] }])).toEqual({
      source: "s",
      active,
    });
    expect(mergeAlerting("s", [{ active }, { error: "No answer in 20s" }])).toEqual({
      source: "s",
      error: "No answer in 20s",
    });
    expect(mergeAlerting("s", [])).toEqual({
      source: "s",
      error: "No Prometheus pod is running and ready",
    });
  });

  it("is read from each pod under its proxy path", () => {
    const [pod] = queryPods(seed(), "Prometheus", pods()).pods;

    expect(pod && alertmanagersPath(pod)).toBe(
      "/api/v1/namespaces/monitoring/pods/prometheus-seed-0:9090/proxy/api/v1/alertmanagers",
    );
  });
});

describe("the pod to ask", () => {
  it("is the seed's ready pod on its web port", () => {
    expect(queryPods(seed(), "Prometheus", pods())).toEqual({
      pods: [
        {
          namespace: "monitoring",
          pod: "prometheus-seed-0",
          port: 9090,
          shard: "0",
          proxy: "/api/v1/namespaces/monitoring/pods/prometheus-seed-0:9090/proxy",
        },
      ],
      missing: [],
    });
  });

  it("goes through HTTPS and under the route prefix when the Prometheus sets them", () => {
    const proxyOf = (change: (spec: ReturnType<typeof seed>["spec"]) => void) =>
      queryPods(
        variant(seed(), (data) => change(data.spec)),
        "Prometheus",
        pods(),
      ).pods[0]?.proxy;
    const base = "/api/v1/namespaces/monitoring/pods";

    expect(
      proxyOf((spec) => {
        spec.routePrefix = "/prom/";
        spec.web = { tlsConfig: { keySecret: { name: "tls", key: "tls.key" } } };
      }),
    ).toBe(`${base}/https:prometheus-seed-0:9090/proxy/prom`);
    expect(
      proxyOf((spec) => {
        spec.routePrefix = "prom";
      }),
    ).toBe(`${base}/prometheus-seed-0:9090/proxy/prom`);
    // The seed's pod runs with --web.route-prefix=/ though its spec sets no externalUrl or routePrefix.
    expect(
      proxyOf((spec) => {
        (spec as Record<string, unknown>).externalUrl = "https://example.test/monitoring/";
      }),
    ).toBe(`${base}/prometheus-seed-0:9090/proxy`);
    expect(
      proxyOf((spec) => {
        spec.routePrefix = "/";
      }),
    ).toBe(`${base}/prometheus-seed-0:9090/proxy`);
  });

  it("follows the route prefix the operator passed to no-image's pod", () => {
    const pod = named(pods(), "prom-broken/prometheus-no-image-0");
    const container = pod.spec?.containers?.find((each) => each.name === "prometheus") as
      | { args?: string[] }
      | undefined;
    const prefix = container?.args
      ?.find((arg) => arg.startsWith("--web.route-prefix="))
      ?.split("=")[1];

    expect(prefix).toBe("/prom");
    expect(
      proxyPath(named(prometheuses(), "prom-broken/no-image"), {
        namespace: "prom-broken",
        pod: "prometheus-no-image-0",
        port: 9090,
      }),
    ).toBe(`/api/v1/namespaces/prom-broken/pods/prometheus-no-image-0:9090/proxy${prefix}`);
  });

  it("reads the API under that path", () => {
    const [pod] = queryPods(
      variant(seed(), (data) => {
        data.spec.routePrefix = "/prom";
        data.spec.web = { tlsConfig: { keySecret: { name: "tls", key: "tls.key" } } };
      }),
      "Prometheus",
      pods(),
    ).pods;
    const root = "/api/v1/namespaces/monitoring/pods/https:prometheus-seed-0:9090/proxy/prom";

    expect(pod && apiReads(pod, true)).toEqual({
      targets: `${root}/api/v1/targets?state=active`,
      pools: `${root}/api/v1/scrape_pools`,
      rules: `${root}/api/v1/rules`,
    });
    expect(pod && apiReads(pod, false).rules).toBeUndefined();
  });

  it("is missing for no-image, whose pod is not ready, and for the agent, which has none", () => {
    expect(
      queryPods(named(prometheuses(), "prom-broken/no-image"), "Prometheus", pods()).missing,
    ).toEqual(["No ready pod for shard 0"]);
    expect(queryPods(named(agents(), "monitoring/agent"), "PrometheusAgent", pods()).pods).toEqual(
      [],
    );
  });

  it("is one per shard, and a shard without a ready pod is named", () => {
    const sharded = variant(seed(), (data) => {
      data.spec.shards = 2;
    });
    const seedPod = named(pods(), "monitoring/prometheus-seed-0");
    const twin = variant(seedPod, (data) => {
      data.metadata.name = "prometheus-seed-1";
    });
    const otherShard = variant(seedPod, (data) => {
      data.metadata.name = "prometheus-seed-shard-1-0";
      if (data.metadata.labels) data.metadata.labels["operator.prometheus.io/shard"] = "1";
    });

    expect(queryPods(sharded, "Prometheus", [seedPod, twin]).missing).toEqual([
      "No ready pod for shard 1",
    ]);
    expect(
      queryPods(sharded, "Prometheus", [seedPod, twin, otherShard]).pods.map((each) => each.pod),
    ).toEqual(["prometheus-seed-0", "prometheus-seed-shard-1-0"]);
  });

  it("skips a pod without the port, and takes shard 0 when the label is missing", () => {
    const seedPod = named(pods(), "monitoring/prometheus-seed-0");
    const renamed = variant(seed(), (data) => {
      data.spec.portName = "http";
    });
    const unlabelled = variant(seedPod, (data) => {
      delete data.metadata.labels?.["operator.prometheus.io/shard"];
    });

    expect(queryPods(renamed, "Prometheus", [seedPod]).pods).toEqual([]);
    const defaultPort = variant(seed(), (data) => {
      delete data.spec.portName;
    });
    const bare = variant(seedPod, (data) => {
      delete data.metadata.labels;
    });
    const noStatus = variant(seedPod, (data) => {
      delete data.status;
    });
    const noPorts = variant(seedPod, (data) => {
      for (const container of data.spec?.containers ?? []) delete container.ports;
    });
    const noSpec = variant(seedPod, (data) => {
      delete data.spec;
    });

    expect(queryPods(defaultPort, "Prometheus", [seedPod]).pods).toHaveLength(1);
    expect(queryPods(seed(), "Prometheus", [bare, noStatus, noPorts, noSpec]).pods).toEqual([]);
    expect(queryPods(seed(), "Prometheus", [unlabelled]).pods[0]?.shard).toBe("0");
  });
});

describe("a PrometheusAgent in DaemonSet mode", () => {
  const daemonSet = (status?: { replicas?: number; availableReplicas?: number }) =>
    variant(named(agents(), "monitoring/agent"), (data) => {
      data.spec.mode = "DaemonSet";
      data.spec.paused = false;
      data.spec.shards = 2;
      data.spec.replicas = 3;
      if (status) data.status = { ...data.status, ...status };
    });
  // The seed's pod, relabelled as the agent's on another node: the operator labels both alike.
  const agentPod = (name: string, ready = true) =>
    variant(named(pods(), "monitoring/prometheus-seed-0"), (data) => {
      data.metadata.name = name;
      data.metadata.labels = {
        ...data.metadata.labels,
        "app.kubernetes.io/name": "prometheus-agent",
        "operator.prometheus.io/name": "agent",
      };
      if (!ready && data.status) data.status.phase = "Pending";
    });

  it("reads every pod, since each scrapes only its own node", () => {
    const read = queryPods(daemonSet(), "PrometheusAgent", [
      agentPod("prom-agent-agent-a"),
      agentPod("prom-agent-agent-b"),
    ]);

    expect(read.pods.map((each) => each.pod)).toEqual(["prom-agent-agent-a", "prom-agent-agent-b"]);
    expect(read.missing).toEqual([]);
  });

  it("names a pod that is not ready, so the read is not taken as whole", () => {
    expect(
      queryPods(daemonSet(), "PrometheusAgent", [
        agentPod("prom-agent-agent-a"),
        agentPod("prom-agent-agent-b", false),
      ]).missing,
    ).toEqual(["Pod prom-agent-agent-b is not running and ready"]);
  });

  it("counts the pods its status schedules, not replicas × shards", () => {
    const row = rowOf(
      instanceRows([], [daemonSet({ replicas: 5, availableReplicas: 5 })], []),
      "PrometheusAgent/monitoring/agent",
    );

    expect([row.desired, row.ready, row.shards]).toEqual([5, 5, 1]);
    expect(
      rowOf(
        instanceRows([], [daemonSet({ replicas: undefined, availableReplicas: 2 })], []),
        "PrometheusAgent/monitoring/agent",
      ).desired,
    ).toBe(2);
  });
});
