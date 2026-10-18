import { describe, expect, it } from "vitest";

import {
  bindingsOf,
  describeSource,
  monitorSelection,
  namespaceLabelsOf,
  ruleSelection,
  selectorSources,
} from "../../src/renderer/api/shared/selection";
import type { MonitorKind, MonitorLike } from "../../src/renderer/api/shared/types";
import {
  agents,
  collectors,
  named,
  namespaces,
  podMonitors,
  prometheuses,
  prometheusRules,
  scrapeConfigs,
  serviceMonitors,
  sources,
  variant,
} from "../support/fixtures";

const labels = () => namespaceLabelsOf(namespaces());
const keys = (list: { key: string }[]) => list.map((each) => each.key);

function selectionOf(kind: MonitorKind, list: MonitorLike[], key: string) {
  return monitorSelection(named(list, key), kind, sources(), labels());
}

describe("sources", () => {
  it("are every Prometheus and agent, and each collector whose TargetAllocator reads the CRs", () => {
    expect(keys(sources())).toEqual([
      "Prometheus/monitoring/seed",
      "Prometheus/prom-broken/no-image",
      "PrometheusAgent/monitoring/agent",
      "TargetAllocator/otel-collectors/scraper",
    ]);
  });

  it("list the paused agent, without rules", () => {
    const agent = sources().find((each) => each.kind === "PrometheusAgent");

    expect(agent?.paused).toBe(true);
    expect(agent?.rules).toBeUndefined();
  });

  it("give a TargetAllocator every namespace when its namespace selectors are unset", () => {
    const scraper = named(collectors(), "otel-collectors/scraper");
    const unset = variant(scraper, (data) => {
      delete data.spec.targetAllocator?.prometheusCR?.serviceMonitorNamespaceSelector;
    });
    const [source] = selectorSources([], [], [unset]);

    expect(source?.selectors.ServiceMonitor.namespaceSelector).toEqual({});
    expect(source?.selectors.ScrapeConfig.selector).toBeUndefined();
  });

  it("leave out a collector whose TargetAllocator does not read the CRs", () => {
    const off = variant(named(collectors(), "otel-collectors/scraper"), (data) => {
      if (data.spec.targetAllocator?.prometheusCR)
        data.spec.targetAllocator.prometheusCR.enabled = false;
    });

    expect(selectorSources([], [], [off])).toEqual([]);
    expect(selectorSources([], [], [named(collectors(), "otel-collectors/gateway")])).toEqual([]);
  });

  it("are named for people", () => {
    const [prometheus, , , allocator] = sources();

    expect(prometheus && describeSource(prometheus)).toBe("Prometheus monitoring/seed");
    expect(allocator && describeSource(allocator)).toBe(
      "TargetAllocator of otel-collectors/scraper",
    );
  });
});

describe("who selects a monitor", () => {
  it("the seed Prometheus selects prom-self, and nobody else does", () => {
    const selection = selectionOf("ServiceMonitor", serviceMonitors(), "monitoring/prom-self");

    expect(keys(selection.selectedBy)).toEqual(["Prometheus/monitoring/seed"]);
    expect(selection.excludedBy).toEqual([]);
  });

  it("the TargetAllocator selects otel-self", () => {
    expect(
      keys(selectionOf("ServiceMonitor", serviceMonitors(), "prom-apps/otel-self").selectedBy),
    ).toEqual(["TargetAllocator/otel-collectors/scraper"]);
  });

  it("nobody selects orphan's labels", () => {
    const selection = selectionOf("ServiceMonitor", serviceMonitors(), "prom-apps/orphan");

    expect(selection.selectedBy).toEqual([]);
    expect(selection.excludedBy).toEqual([]);
  });

  it("excluded has the right labels in a namespace the seed does not select", () => {
    const selection = selectionOf("ServiceMonitor", serviceMonitors(), "prom-outside/excluded");

    expect(selection.selectedBy).toEqual([]);
    expect(keys(selection.excludedBy)).toEqual(["Prometheus/monitoring/seed"]);
  });

  it("a PodMonitor and a ScrapeConfig are picked by their own selectors", () => {
    expect(
      keys(selectionOf("PodMonitor", podMonitors(), "prom-apps/prom-pods").selectedBy),
    ).toEqual(["Prometheus/monitoring/seed"]);
    expect(
      keys(selectionOf("ScrapeConfig", scrapeConfigs(), "prom-apps/static-self").selectedBy),
    ).toEqual(["Prometheus/monitoring/seed"]);
  });

  it("a TargetAllocator's deny list leaves a namespace out", () => {
    const denying = variant(named(collectors(), "otel-collectors/scraper"), (data) => {
      if (data.spec.targetAllocator?.prometheusCR) {
        data.spec.targetAllocator.prometheusCR.denyNamespaces = ["prom-apps"];
      }
    });
    const selection = monitorSelection(
      named(serviceMonitors(), "prom-apps/otel-self"),
      "ServiceMonitor",
      selectorSources([], [], [denying]),
      labels(),
    );

    expect(selection.selectedBy).toEqual([]);
    expect(keys(selection.excludedBy)).toEqual(["TargetAllocator/otel-collectors/scraper"]);
  });

  it("a binding, when the operator writes one, decides instead of the selectors", () => {
    const refused = variant(named(serviceMonitors(), "prom-apps/orphan"), (data) => {
      data.status = {
        bindings: [
          {
            group: "monitoring.coreos.com",
            resource: "prometheuses",
            name: "seed",
            namespace: "monitoring",
            conditions: [
              {
                type: "Accepted",
                status: "False",
                reason: "InvalidConfiguration",
                message: "bad port",
              },
            ],
          },
          { resource: "thanosrulers", name: "ruler", namespace: "monitoring" },
        ],
      };
    });
    const selection = monitorSelection(refused, "ServiceMonitor", sources(), labels());

    expect(keys(selection.selectedBy)).toEqual(["Prometheus/monitoring/seed"]);
    expect(selection.refusedBy.map((each) => each.message)).toEqual(["bad port"]);
  });
});

describe("bindings", () => {
  it("read each Accepted condition and skip what they cannot name", () => {
    const accepted = variant(named(serviceMonitors(), "monitoring/prom-self"), (data) => {
      data.status = {
        bindings: [
          {
            resource: "prometheusagents",
            name: "agent",
            namespace: "monitoring",
            conditions: [{ type: "Accepted", status: "True" }],
          },
          { resource: "prometheuses", name: "seed", namespace: "monitoring" },
          { resource: "prometheuses", namespace: "monitoring" },
          { resource: "prometheuses", name: "seed" },
          { name: "seed", namespace: "monitoring" },
        ],
      };
    });

    expect(bindingsOf(accepted)).toEqual([
      {
        key: "PrometheusAgent/monitoring/agent",
        accepted: true,
        reason: undefined,
        message: undefined,
      },
      {
        key: "Prometheus/monitoring/seed",
        accepted: undefined,
        reason: undefined,
        message: undefined,
      },
      { key: "Prometheus//seed", accepted: undefined, reason: undefined, message: undefined },
    ]);
    expect(bindingsOf(named(serviceMonitors(), "monitoring/prom-self"))).toEqual([]);
  });

  it("a refusal without a message still says it was not accepted", () => {
    const refused = variant(named(serviceMonitors(), "monitoring/prom-self"), (data) => {
      data.status = {
        bindings: [
          {
            resource: "prometheuses",
            name: "seed",
            namespace: "monitoring",
            conditions: [{ type: "Accepted", status: "False" }],
          },
        ],
      };
    });

    expect(
      monitorSelection(refused, "ServiceMonitor", sources(), labels()).refusedBy[0]?.message,
    ).toBe("Not accepted");
  });
});

describe("an accepting binding", () => {
  it("selects without a refusal, even where the selectors would not", () => {
    const accepted = variant(named(serviceMonitors(), "prom-apps/orphan"), (data) => {
      data.status = {
        bindings: [
          {
            resource: "prometheuses",
            name: "seed",
            namespace: "monitoring",
            conditions: [{ type: "Accepted", status: "True" }],
          },
        ],
      };
    });
    const selection = monitorSelection(accepted, "ServiceMonitor", sources(), labels());

    expect(keys(selection.selectedBy)).toEqual(["Prometheus/monitoring/seed"]);
    expect(selection.refusedBy).toEqual([]);
  });

  it("a namespace without labels reads as having none", () => {
    const bare = variant(named(namespaces(), "/prom-apps"), (data) => {
      delete data.metadata.labels;
    });

    expect(namespaceLabelsOf([bare]).get("prom-apps")).toEqual({});
  });
});

describe("who selects a rule", () => {
  const ruleSelectionOf = (key: string) =>
    ruleSelection(
      named(prometheusRules(), key),
      selectorSources(prometheuses(), agents(), collectors()),
      labels(),
    );

  it("the seed loads always-firing; nobody selects unselected-rule; excluded-rule sits outside", () => {
    expect(keys(ruleSelectionOf("prom-apps/always-firing").selectedBy)).toEqual([
      "Prometheus/monitoring/seed",
    ]);
    expect(ruleSelectionOf("prom-apps/unselected-rule").selectedBy).toEqual([]);
    expect(keys(ruleSelectionOf("prom-outside/excluded-rule").excludedBy)).toEqual([
      "Prometheus/monitoring/seed",
    ]);
  });
});
