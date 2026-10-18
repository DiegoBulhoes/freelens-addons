import { describe, expect, it } from "vitest";
import { instanceRows } from "../../src/renderer/api/instances/instances";
import { monitorRows } from "../../src/renderer/api/monitors/monitors";
import { kubernetesChecks } from "../../src/renderer/api/monitors/targets";
import { ruleRows } from "../../src/renderer/api/rules/rules";
import {
  describeLive,
  describeTarget,
  endpointFacts,
  type Fact,
  hostPart,
  instanceFacts,
  linkTitle,
  monitorFacts,
  ruleFacts,
  shortSourceNames,
} from "../../src/renderer/api/shared/facts";
import { hostListOf } from "../../src/renderer/api/shared/host-links";
import {
  agents,
  alertingReads,
  alertmanagers,
  endpointSlices,
  monitorInventory,
  NOW,
  named,
  podMonitors,
  pods,
  prometheuses,
  ruleInventory,
  services,
  variant,
} from "../support/fixtures";

const find = <Row extends { key: string }>(rows: Row[], key: string): Row => {
  const found = rows.find((row) => row.key === key);

  if (!found) throw new Error(`no row ${key}`);

  return found;
};
const monitor = (key: string) => find(monitorRows(monitorInventory()), key);
const factValue = (facts: Fact[], term: string) => facts.find((fact) => fact.term === term)?.value;
const factParts = (facts: Fact[], term: string) => facts.find((fact) => fact.term === term)?.parts;

const SEED = {
  page: "instances",
  kind: "Prometheus",
  namespace: "monitoring",
  name: "seed",
} as const;

describe("table cells", () => {
  it("say who selects a monitor, what it reaches and how its targets answer", () => {
    const kubelet = monitor("ServiceMonitor/monitoring/kubelet");

    expect(shortSourceNames(kubelet.selection.selectedBy)).toBe("monitoring/seed");
    expect(
      shortSourceNames(monitor("ServiceMonitor/prom-apps/otel-self").selection.selectedBy),
    ).toBe("TA otel-collectors/scraper");
    expect(shortSourceNames([])).toBe("Nobody");
    expect(describeTarget(kubelet)).toBe("1 Service · port https-metrics · 1 endpoint · 1 ready");
    expect(describeTarget(monitor("ServiceMonitor/prom-apps/no-service"))).toMatch(/^0 Services/);
    expect(describeTarget(monitor("PodMonitor/prom-apps/prom-pods"))).toMatch(/^1 pod · port web/);
    expect(describeTarget(monitor("ScrapeConfig/prom-apps/static-self"))).toBe("1 static target");
    expect(
      describeTarget({
        ...monitor("ScrapeConfig/prom-apps/static-self"),
        monitor: { ...monitor("ScrapeConfig/prom-apps/static-self").monitor, spec: {} },
      }),
    ).toBe("Its own discovery");
    expect(describeTarget({ ...kubelet, checks: [] })).toBe("No endpoint");
    expect(
      describeTarget({
        ...kubelet,
        checks: kubelet.checks.map((check) => ({ ...check, port: undefined })),
      }),
    ).toBe("1 Service · 1 endpoint · 1 ready");
    expect(describeLive(kubelet)).toBe("2 up");
    expect(describeLive(monitor("ServiceMonitor/monitoring/down-path"))).toBe("0 up · 1 down");
    expect(describeLive(monitor("ServiceMonitor/prom-apps/otel-self"))).toBe("Unknown");
    expect(
      describeLive({
        ...kubelet,
        health: { up: 0, down: 0, unknown: 2, errors: [], targets: [] },
      }),
    ).toBe("0 up · 2 pending");
  });
});

describe("drawer facts", () => {
  it("for a ServiceMonitor: who selects it, where it looks, how it scrapes", () => {
    expect(monitorFacts(monitor("ServiceMonitor/monitoring/kubelet"))).toEqual([
      { term: "Kind", value: "ServiceMonitor" },
      {
        term: "Selected by",
        value: "Prometheus monitoring/seed",
        parts: [{ text: "Prometheus monitoring/seed", to: SEED }],
      },
      { term: "Selector", value: "app.kubernetes.io/name=kubelet" },
      { term: "Looks in", value: "kube-system" },
      { term: "Live", value: "2 up, 0 down" },
    ]);
  });

  it("for excluded, orphan, otel-self and a ScrapeConfig", () => {
    expect(
      factValue(
        monitorFacts(monitor("ServiceMonitor/prom-outside/excluded")),
        "Labels match, namespace not",
      ),
    ).toBe("Prometheus monitoring/seed");
    expect(factValue(monitorFacts(monitor("ServiceMonitor/prom-apps/orphan")), "Selected by")).toBe(
      "Nobody",
    );
    expect(factValue(monitorFacts(monitor("ServiceMonitor/prom-apps/otel-self")), "Live")).toBe(
      "Unknown: no Prometheus that selects it was read",
    );
    expect(
      factValue(monitorFacts(monitor("ScrapeConfig/prom-apps/static-self")), "Static targets"),
    ).toBe("prometheus-operated.monitoring.svc:9090");
  });

  it("for a ScrapeConfig without static targets, a monitor that looks everywhere, and targets not yet scraped", () => {
    const scrape = monitor("ScrapeConfig/prom-apps/static-self");
    const self = monitor("ServiceMonitor/monitoring/prom-self");
    const everywhere = { ...self, looksIn: { any: true as const } };

    expect(
      factValue(
        monitorFacts({ ...scrape, monitor: { ...scrape.monitor, spec: { staticConfigs: [{}] } } }),
        "Static targets",
      ),
    ).toBe("None");
    expect(factValue(monitorFacts(everywhere as typeof self), "Looks in")).toBe("Every namespace");
    expect(
      factValue(
        monitorFacts({ ...self, health: self.health && { ...self.health, unknown: 2 } }),
        "Live",
      ),
    ).toBe("1 up, 0 down, 2 not scraped yet");
  });

  it("for each endpoint check", () => {
    const [wrong] = monitor("ServiceMonitor/prom-apps/wrong-port").checks;
    const [none] = monitor("ServiceMonitor/prom-apps/no-service").checks;

    expect(wrong && endpointFacts(wrong, "Service")).toEqual([
      { term: "Port", value: "metrics" },
      {
        term: "Matched",
        value: "monitoring/prometheus-operated",
        parts: [
          {
            text: "monitoring/prometheus-operated",
            to: { host: "Service", name: "prometheus-operated" },
          },
        ],
      },
      { term: "With the port", value: "None" },
      { term: "Endpoints", value: "0" },
      { term: "Ready", value: "0" },
      { term: "Check", value: "Port not found" },
    ]);
    expect(none && factValue(endpointFacts(none, "Service"), "Matched")).toBe("Nothing");
    expect(none && factParts(endpointFacts(none, "Service"), "Matched")).toBeUndefined();

    const noImage = variant(named(podMonitors(), "prom-apps/prom-pods"), (data) => {
      data.spec.namespaceSelector = { matchNames: ["prom-broken"] };
      data.spec.selector = { matchLabels: { "operator.prometheus.io/name": "no-image" } };
    });
    const [unready] = kubernetesChecks("PodMonitor", noImage, {
      services: services(),
      endpointSlices: endpointSlices(),
      pods: pods(),
    });

    expect(unready && factValue(endpointFacts(unready, "Pod"), "Ready")).toBe("0");
    expect(unready && factValue(endpointFacts(unready, "Pod"), "Check")).toBe("Has endpoints");
    const podPart = {
      text: "prom-broken/prometheus-no-image-0",
      to: { host: "Pod", name: "prometheus-no-image-0" },
    };

    expect(unready && factParts(endpointFacts(unready, "Pod"), "Matched")).toEqual([podPart]);
    expect(unready && factParts(endpointFacts(unready, "Pod"), "With the port")).toEqual([podPart]);
    const unchecked = none && { ...none, port: undefined, state: "unchecked" as const };

    expect(unchecked && factValue(endpointFacts(unchecked, "Service"), "Port")).toBe("—");
  });

  it("for a rule: who loads it, what it holds, since when it fires", () => {
    const rows = ruleRows(ruleInventory());
    const firing = find(rows, "PrometheusRule/prom-apps/always-firing");
    const seedPart = {
      text: "Prometheus monitoring/seed",
      to: SEED,
    };

    expect(ruleFacts(firing, NOW)).toEqual([
      { term: "Loaded by", value: "Prometheus monitoring/seed", parts: [seedPart] },
      { term: "Selected by", value: "Prometheus monitoring/seed", parts: [seedPart] },
      { term: "Groups", value: "1" },
      { term: "Rules", value: "1 alerting rule, 0 recording rules" },
      { term: "Firing", value: "1, since 1h ago" },
    ]);
    expect(
      factValue(
        ruleFacts(find(rows, "PrometheusRule/prom-apps/unselected-rule"), NOW),
        "Loaded by",
      ),
    ).toBe("Nobody");
    expect(
      factParts(
        ruleFacts(find(rows, "PrometheusRule/prom-apps/unselected-rule"), NOW),
        "Loaded by",
      ),
    ).toBeUndefined();
    expect(
      factValue(ruleFacts(find(rows, "PrometheusRule/prom-apps/recording"), NOW), "Firing"),
    ).toBe("None");

    const [alert] = firing.firing;
    const later = alert && { ...alert, activeAt: "2026-10-12T16:00:00Z" };

    expect(
      factValue(
        ruleFacts({ ...firing, firing: later && alert ? [later, alert] : [] }, NOW),
        "Firing",
      ),
    ).toBe("2, since 1h ago");
  });

  it("for an instance: readiness, conditions, selectors, Alertmanagers", () => {
    const rows = instanceRows(prometheuses(), agents(), alertmanagers());

    expect(instanceFacts(find(rows, "Prometheus/prom-broken/no-image"))).toEqual([
      { term: "Kind", value: "Prometheus" },
      { term: "Ready", value: "0 of 1" },
      { term: "Shards", value: "1" },
      {
        term: "Available",
        value:
          "False: shard 0: pod prometheus-no-image-0: containers with unready status: [prometheus]",
      },
      {
        term: "Reconciled",
        value:
          "True: No ServiceMonitor, PodMonitor, Probe, ScrapeConfig, and PrometheusRule have been selected.",
      },
      { term: "ServiceMonitors", value: "scraper=none" },
      { term: "PodMonitors", value: "nothing" },
      { term: "ScrapeConfigs", value: "nothing" },
      { term: "Rules", value: "nothing" },
      { term: "Alertmanagers", value: "None" },
    ]);
    expect(
      instanceFacts(find(rows, "Alertmanager/monitoring/seed")).map((fact) => fact.term),
    ).toEqual(["Kind", "Ready", "Available", "Reconciled"]);
    expect(factValue(instanceFacts(find(rows, "Prometheus/monitoring/seed")), "Available")).toBe(
      "True",
    );

    const silent = find(rows, "Prometheus/monitoring/seed");

    expect(factValue(instanceFacts({ ...silent, available: undefined }), "Available")).toBe(
      "Not reported",
    );
  });
});

describe("drawer links", () => {
  it("name an instance that selects a monitor, but leave a TargetAllocator's collector as text", () => {
    expect(
      factParts(monitorFacts(monitor("ServiceMonitor/prom-apps/otel-self")), "Selected by"),
    ).toEqual([{ text: "TargetAllocator of otel-collectors/scraper" }]);
    expect(
      factParts(
        monitorFacts(monitor("ServiceMonitor/prom-outside/excluded")),
        "Labels match, namespace not",
      ),
    ).toEqual([{ text: "Prometheus monitoring/seed", to: SEED }]);
    expect(
      factParts(monitorFacts(monitor("ServiceMonitor/prom-apps/orphan")), "Selected by"),
    ).toBeUndefined();
  });

  it("send a Prometheus's Alertmanager entries to the Services list, and say where alerts go", () => {
    const rows = instanceRows(prometheuses(), agents(), alertmanagers(), alertingReads());
    const facts = instanceFacts(find(rows, "Prometheus/monitoring/seed"));

    expect(factParts(facts, "Alertmanagers")).toEqual([
      {
        text: "monitoring/alertmanager-operated:web",
        to: { host: "Service", name: "alertmanager-operated" },
      },
      { text: "monitoring/alertmanager:web", to: { host: "Service", name: "alertmanager" } },
    ]);
    expect(factValue(facts, "Sends alerts to")).toBe("http://198.51.100.10:9093/api/v2/alerts");
    expect(
      factValue(instanceFacts(find(rows, "Prometheus/prom-broken/no-image")), "Sends alerts to"),
    ).toBeUndefined();
  });

  it("say where they go, as the host's own links and the list rows do", () => {
    expect(linkTitle(SEED)).toBe("Opens seed in the Instances list");
    expect(linkTitle({ host: "Service", name: "prometheus-operated" })).toBe(
      "Opens the Services list narrowed to prometheus-operated",
    );
    expect(linkTitle({ host: "Node", name: "worker-1" })).toBe(
      "Opens the Nodes list narrowed to worker-1",
    );
    expect(hostPart("Pod", "monitoring/prometheus-seed-0")).toEqual({
      text: "monitoring/prometheus-seed-0",
      to: { host: "Pod", name: "prometheus-seed-0" },
    });
    expect(hostListOf("Service", "prometheus-operated")).toBe(
      "/services?search=prometheus-operated",
    );
  });
});
