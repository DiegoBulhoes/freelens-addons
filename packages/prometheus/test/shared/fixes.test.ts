import { describe, expect, it } from "vitest";
import { type MonitorRow, monitorRows } from "../../src/renderer/api/monitors/monitors";
import { type RuleRow, ruleRows } from "../../src/renderer/api/rules/rules";
import {
  candidateSources,
  commandsFor,
  fixTitle,
  fixTooltip,
  monitorFixes,
  monitorFixYaml,
  ruleFixes,
  ruleFixYaml,
  yamlScalar,
} from "../../src/renderer/api/shared/fixes";
import { namespaceLabelsOf, selectorSources } from "../../src/renderer/api/shared/selection";
import {
  agents,
  collectors,
  monitorInventory,
  namespaces,
  podMonitors,
  prometheuses,
  readsWithoutTargetsOf,
  ruleInventory,
  serviceMonitors,
  sourceNamed,
  sources,
  variant,
} from "../support/fixtures";

const find = <Row extends { key: string }>(rows: Row[], key: string): Row => {
  const found = rows.find((row) => row.key === key);

  if (!found) throw new Error(`no row ${key}`);

  return found;
};
const monitor = (key: string, rows: MonitorRow[] = monitorRows(monitorInventory())) =>
  find(rows, key);
const rule = (key: string, rows: RuleRow[] = ruleRows(ruleInventory())) => find(rows, key);
const labels = () => namespaceLabelsOf(namespaces());

describe("fix YAML for a monitor", () => {
  it("orphan can join the seed Prometheus or the TargetAllocator, each by its own label", () => {
    const orphan = monitor("ServiceMonitor/prom-apps/orphan");

    expect(candidateSources(orphan, sources(), labels()).map((each) => each.key)).toEqual([
      "Prometheus/monitoring/seed",
      "TargetAllocator/otel-collectors/scraper",
    ]);
    expect(monitorFixYaml(orphan, sourceNamed("Prometheus/monitoring/seed"))).toBe(
      [
        "# Labels that Prometheus monitoring/seed selects on.",
        "metadata:",
        "  labels:",
        "    scraper: prometheus",
      ].join("\n"),
    );
    expect(
      monitorFixYaml(orphan, sourceNamed("TargetAllocator/otel-collectors/scraper")),
    ).toContain("    scraper: otel");
    expect(monitorFixYaml(orphan)).toBeUndefined();
  });

  it("a source whose selector is unset or empty says so", () => {
    const orphan = monitor("ServiceMonitor/prom-apps/orphan");
    const allocator = sourceNamed("TargetAllocator/otel-collectors/scraper");
    const everything = {
      ...allocator,
      selectors: {
        ...allocator.selectors,
        ServiceMonitor: { selector: {}, namespaceSelector: {} },
      },
    };
    const withExpression = {
      ...allocator,
      selectors: {
        ...allocator.selectors,
        ServiceMonitor: {
          selector: {
            matchLabels: { scraper: "otel" },
            matchExpressions: [{ key: "team", operator: "Exists" }],
          },
          namespaceSelector: {},
        },
      },
    };

    expect(monitorFixYaml({ ...orphan, kind: "ScrapeConfig" }, allocator)).toBe(
      "# TargetAllocator of otel-collectors/scraper selects no ScrapeConfigs: its selector is not set.",
    );
    expect(monitorFixYaml(orphan, everything)).toContain(
      "    # its selector is {}: any label will do",
    );
    expect(monitorFixYaml(orphan, withExpression)).toContain("    # and also: team");
  });

  it("excluded needs its namespace labelled", () => {
    expect(monitorFixYaml(monitor("ServiceMonitor/prom-outside/excluded"))).toBe(
      [
        "# Labels that Prometheus monitoring/seed selects namespaces on.",
        "apiVersion: v1",
        "kind: Namespace",
        "metadata:",
        "  name: prom-outside",
        "  labels:",
        '    seed.freelens/prometheus: "true"',
      ].join("\n"),
    );
  });

  it("a source that reads only its own namespace asks to move the monitor", () => {
    const homeOnly = prometheuses().map((each) =>
      variant(each, (data) => {
        delete data.spec.serviceMonitorNamespaceSelector;
      }),
    );
    const rows = monitorRows(
      monitorInventory({ sources: selectorSources(homeOnly, agents(), collectors()) }),
    );

    expect(monitorFixYaml(monitor("ServiceMonitor/prom-apps/wrong-port", rows))).toBe(
      "# Prometheus monitoring/seed reads only its own namespace, monitoring: move it there.",
    );
  });

  it("wrong-port takes the one port the Service has, and says what it was", () => {
    expect(monitorFixYaml(monitor("ServiceMonitor/prom-apps/wrong-port"))).toBe(
      ["spec:", "  endpoints:", "    - port: web # was: metrics"].join("\n"),
    );
  });

  it("keeps every endpoint and the failing one's settings, so the list merges whole", () => {
    const rows = monitorRows(
      monitorInventory({
        serviceMonitors: serviceMonitors().map((each) =>
          each.getName() === "kubelet"
            ? variant(each, (data) => {
                const second = data.spec.endpoints?.[1];

                if (second) second.port = "metrics";
              })
            : each,
        ),
      }),
    );
    const yaml = monitorFixYaml(monitor("ServiceMonitor/monitoring/kubelet", rows));

    expect(yaml).toBe(
      [
        "spec:",
        "  endpoints:",
        "    - port: https-metrics",
        "      path: /metrics/cadvisor",
        "      scheme: https",
        "      # keep its other fields as they are",
        "    - port: <port name> # was: metrics; one of: https-metrics, cadvisor, http-metrics",
        "      path: /metrics",
        "      scheme: https",
        "      # keep its other fields as they are",
      ].join("\n"),
    );
    expect(yaml).not.toMatch(/bearer|token|tls/i);
  });

  it("a port asked by number names what it was, and an endpoint with only other fields stays", () => {
    const rows = monitorRows(
      monitorInventory({
        podMonitors: podMonitors().map((each) =>
          variant(each, (data) => {
            data.spec.podMetricsEndpoints = [
              { relabelings: [] } as never,
              { portNumber: 1234, interval: "30s" },
            ];
          }),
        ),
      }),
    );

    expect(monitorFixYaml(monitor("PodMonitor/prom-apps/prom-pods", rows))).toBe(
      [
        "spec:",
        "  podMetricsEndpoints:",
        "    - {} # keep its fields as they are",
        "    - port: <port name> # was: portNumber 1234; one of: web, reloader-web",
        "      interval: 30s",
      ].join("\n"),
    );
  });

  it("no-service shows the labels a Service needs", () => {
    expect(monitorFixYaml(monitor("ServiceMonitor/prom-apps/no-service"))).toBe(
      [
        "# Labels a Service needs for no-service to select it.",
        "metadata:",
        "  labels:",
        "    app: ghost",
      ].join("\n"),
    );
  });

  it("a PodMonitor port fix names podMetricsEndpoints, and an unnamed target says so", () => {
    const rows = monitorRows(
      monitorInventory({
        podMonitors: monitorInventory().podMonitors.map((each) =>
          variant(each, (data) => {
            data.spec.podMetricsEndpoints = [{ port: "nope" }];
          }),
        ),
      }),
    );
    const row = monitor("PodMonitor/prom-apps/prom-pods", rows);

    expect(monitorFixYaml(row)).toContain(
      "  podMetricsEndpoints:\n    - port: <port name> # was: nope; one of: web, reloader-web",
    );
    expect(
      monitorFixYaml({ ...row, checks: row.checks.map((check) => ({ ...check, portNames: [] })) }),
    ).toContain("    - port: <port name> # was: nope; the target names no port");
  });

  it("a PodMonitor without a pod shows the labels a pod needs", () => {
    const rows = monitorRows(
      monitorInventory({
        podMonitors: monitorInventory().podMonitors.map((each) =>
          variant(each, (data) => {
            data.spec.selector = { matchLabels: { app: "ghost" } };
          }),
        ),
        reads: readsWithoutTargetsOf("/prom-pods/"),
      }),
    );

    expect(monitorFixYaml(monitor("PodMonitor/prom-apps/prom-pods", rows))).toContain(
      "# Labels a pod needs for prom-pods to select it.",
    );
  });

  it("nothing for healthy, down or rejected monitors, nor a no-target ScrapeConfig", () => {
    expect(monitorFixYaml(monitor("ServiceMonitor/monitoring/prom-self"))).toBeUndefined();
    expect(monitorFixYaml(monitor("ServiceMonitor/monitoring/down-path"))).toBeUndefined();
    expect(monitorFixYaml(monitor("ServiceMonitor/monitoring/rejected"))).toBeUndefined();

    const scrape = monitor("ScrapeConfig/prom-apps/static-self");

    expect(monitorFixYaml({ ...scrape, state: "no-target" })).toBeUndefined();
    expect(
      monitorFixYaml({ ...monitor("ServiceMonitor/monitoring/prom-self"), state: "port-missing" }),
    ).toBeUndefined();
  });
});

describe("fix YAML for a rule", () => {
  it("unselected-rule needs the seed's rule label; excluded-rule its namespace labelled", () => {
    const unselected = rule("PrometheusRule/prom-apps/unselected-rule");

    expect(candidateSources(unselected, sources(), labels()).map((each) => each.key)).toEqual([
      "Prometheus/monitoring/seed",
    ]);
    expect(ruleFixYaml(unselected, sourceNamed("Prometheus/monitoring/seed"))).toContain(
      "    rules: prometheus",
    );
    expect(ruleFixYaml(unselected)).toBeUndefined();
    expect(ruleFixYaml(rule("PrometheusRule/prom-outside/excluded-rule"))).toContain(
      "  name: prom-outside",
    );
    expect(ruleFixYaml(rule("PrometheusRule/prom-apps/always-firing"))).toBeUndefined();
  });
});

describe("commands", () => {
  it("read the object, and its Events when the operator turned it down", () => {
    const lines = (row: Parameters<typeof commandsFor>[0]) =>
      commandsFor(row).map((each) => each.command);

    expect(
      commandsFor(monitor("ServiceMonitor/monitoring/rejected")).map((each) => each.label),
    ).toEqual(["Its YAML", "Its description and Events", "Why the operator refused it"]);
    expect(lines(monitor("ServiceMonitor/monitoring/rejected"))).toEqual([
      "kubectl get -n monitoring servicemonitor rejected -o yaml",
      "kubectl describe -n monitoring servicemonitor rejected",
      "kubectl get events -n monitoring --field-selector involvedObject.name=rejected,reason=InvalidConfiguration",
    ]);
    expect(lines(rule("PrometheusRule/prom-apps/recording"))).toEqual([
      "kubectl get -n prom-apps prometheusrule recording -o yaml",
      "kubectl describe -n prom-apps prometheusrule recording",
    ]);
    expect(lines({ kind: "Probe", name: "x", namespace: "y", state: "healthy" })[0]).toBe(
      "kubectl get -n y probe x -o yaml",
    );
  });
});

describe("the fixes a drawer offers", () => {
  it("one per source a monitor or rule could join, or the one change it needs", () => {
    const rows = monitorRows(monitorInventory());
    const fixes = (key: string) =>
      monitorFixes(monitor(key, rows), sources(), labels()).map((fix) => fix.label);

    expect(fixes("ServiceMonitor/prom-apps/orphan")).toEqual([
      "Labels to join Prometheus monitoring/seed",
      "Labels to join TargetAllocator of otel-collectors/scraper",
    ]);
    expect(fixes("ServiceMonitor/prom-outside/excluded")).toEqual([
      "Namespace labels Prometheus monitoring/seed selects",
    ]);
    expect(fixes("ServiceMonitor/prom-apps/wrong-port")).toEqual(["The port to scrape"]);
    expect(fixes("ServiceMonitor/prom-apps/no-service")).toEqual(["Labels a Service needs"]);
    expect(fixes("ServiceMonitor/monitoring/prom-self")).toEqual([]);
    expect(
      monitorFixes(
        { ...monitor("ServiceMonitor/prom-apps/no-service", rows), kind: "PodMonitor" },
        sources(),
        labels(),
      ).map((fix) => fix.label),
    ).toEqual(["Labels a pod needs"]);

    const ruleRowsNow = ruleRows(ruleInventory());
    const forRule = (key: string) =>
      ruleFixes(rule(key, ruleRowsNow), sources(), labels()).map((fix) => fix.label);

    expect(forRule("PrometheusRule/prom-apps/unselected-rule")).toEqual([
      "Labels to join Prometheus monitoring/seed",
    ]);
    expect(forRule("PrometheusRule/prom-outside/excluded-rule")).toEqual([
      "Namespace labels Prometheus monitoring/seed selects",
    ]);
    expect(forRule("PrometheusRule/prom-apps/always-firing")).toEqual([]);
  });

  it("each named in its menu item and tooltip", () => {
    const fixes = monitorFixes(
      monitor("ServiceMonitor/prom-apps/orphan", monitorRows(monitorInventory())),
      sources(),
      labels(),
    );

    expect(fixes.map(fixTitle)).toEqual([
      "Copy fix YAML: Labels to join Prometheus monitoring/seed",
      "Copy fix YAML: Labels to join TargetAllocator of otel-collectors/scraper",
    ]);
    expect(fixes.map(fixTooltip)).toEqual([
      "Copies the YAML for: Labels to join Prometheus monitoring/seed. Commit it to Git; changes nothing in the cluster",
      "Copies the YAML for: Labels to join TargetAllocator of otel-collectors/scraper. Commit it to Git; changes nothing in the cluster",
    ]);
  });
});

describe("YAML scalars", () => {
  it("are quoted when YAML would read them as something else", () => {
    expect(yamlScalar("prometheus")).toBe("prometheus");
    expect(yamlScalar("true")).toBe('"true"');
    expect(yamlScalar("0.5")).toBe('"0.5"');
    expect(yamlScalar("a: b")).toBe('"a: b"');
    expect(yamlScalar("")).toBe('""');
    expect(yamlScalar("trailing ")).toBe('"trailing "');
  });
});
