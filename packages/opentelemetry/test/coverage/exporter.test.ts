import { describe, expect, it } from "vitest";

import {
  type CoverageInventory,
  type CoverageRow,
  coverageRows,
} from "../../src/renderer/api/coverage/coverage";
import {
  collectorOfHost,
  exporterOf,
  otlpPorts,
  parseEndpoint,
  resolveExporter,
} from "../../src/renderer/api/coverage/exporter";
import { describeExporter, exporterLink } from "../../src/renderer/api/coverage/facts";
import { keyOf } from "../../src/renderer/api/coverage/resolve";
import type { InstrumentationSpec } from "../../src/renderer/api/shared/types";
import {
  collectorNamed,
  collectors,
  coverageInventory,
  instrumentations,
  NOW,
  namespaces,
  pods,
  variant,
  workloadNamed,
} from "../support/fixtures";

const EVERYWHERE = namespaces().map((namespace) => namespace.getName());

const rowOf = (key: string, inventory: CoverageInventory = coverageInventory()): CoverageRow => {
  const found = coverageRows(inventory).find((row) => `${row.namespace}/${row.name}` === key);

  if (!found) throw new Error(`no row for ${key}`);

  return found;
};

/** checkout, whose Instrumentation otel-apps/python exports to the gateway, its spec changed. */
const checkoutWith = (change: (spec: InstrumentationSpec) => void) =>
  rowOf("otel-apps/checkout", {
    ...coverageInventory(),
    instrumentations: instrumentations().map((each) =>
      keyOf(each) === "otel-apps/python" ? variant(each, (data) => change(data.spec)) : each,
    ),
  });

const endpointed = (endpoint: string) =>
  checkoutWith((spec) => {
    spec.exporter = { ...spec.exporter, endpoint };
  });

const described = (row: CoverageRow, scope = EVERYWHERE) => {
  const exporter = exporterOf(row, { collectors: collectors(), pods: pods(), scope }, NOW);

  if (!exporter) throw new Error("no exporter");

  return describeExporter(exporter);
};

describe("where the agent exports", () => {
  it("is the gateway, ready, for the seed's Instrumentation", () => {
    const row = rowOf("otel-apps/checkout");

    expect(row.state).toBe("injected");
    expect(resolveExporter(row, collectors())).toMatchObject({
      kind: "collector",
      endpoint: "http://gateway-collector.otel-collectors.svc.cluster.local:4318",
      port: 4318,
      ports: [4317, 4318],
    });
    expect(described(row)).toEqual({ value: "otel-collectors/gateway, Ready" });
    expect(described(endpointed("http://gateway-collector.otel-collectors"))).toEqual({
      value: "otel-collectors/gateway, Ready",
    });
  });

  it("warns when the collector it names crash loops, and leaves the row's state alone", () => {
    const row = endpointed("http://broken-collector.otel-collectors:4317");

    expect(row.state).toBe("injected");
    expect(described(row)).toEqual({
      value: "otel-collectors/broken, Crash looping",
      warning:
        "otel-collectors/broken reads Crash looping, so the agent's telemetry is dropped until it runs.",
    });
  });

  it("warns on a port the collector takes no OTLP on", () => {
    expect(described(endpointed("gateway-collector.otel-collectors.svc:9999"))).toEqual({
      value: "otel-collectors/gateway, which takes OTLP on 4317, 4318, not 9999",
      warning:
        "otel-collectors/gateway takes no OTLP on port 9999, so the agent's telemetry is dropped.",
    });
  });

  it("warns when no such collector exists, a short name being in the pod's namespace", () => {
    expect(described(endpointed("http://gateway-collector:4318"))).toEqual({
      value: "Nothing: no collector otel-apps/gateway",
      warning:
        "No OpenTelemetryCollector otel-apps/gateway exists, so the agent's telemetry is dropped.",
    });

    const headless = endpointed("http://absent-collector-headless.otel-collectors:4317");

    expect(resolveExporter(headless, collectors())).toMatchObject({
      kind: "missing",
      namespace: "otel-collectors",
      name: "absent",
    });
  });

  it("warns on a sidecar collector, which has no Service, and on one with no OTLP receiver", () => {
    expect(described(endpointed("sidecar-collector.otel-collectors:4317")).warning).toBe(
      "otel-collectors/sidecar runs as a sidecar with no Service, so the agent's telemetry is dropped.",
    );
    expect(described(endpointed("scraper-collector.otel-collectors:4318"))).toEqual({
      value: "otel-collectors/scraper, which has no OTLP receiver",
      warning: "otel-collectors/scraper has no OTLP receiver, so the agent's telemetry is dropped.",
    });
  });

  it("names the collector without its health outside the namespaces in scope", () => {
    expect(described(rowOf("otel-apps/checkout"), ["otel-apps"])).toEqual({
      value: "otel-collectors/gateway; its pods are outside the namespaces in scope",
    });
  });

  it("is not known for an endpoint that is no collector's Service, or none at all", () => {
    expect(described(endpointed("https://otlp.example.com:4318/v1"))).toEqual({
      value: "Not known: https://otlp.example.com:4318/v1 is not a collector's Service",
    });
    expect(described(endpointed("http://:4318")).value).toBe(
      "Not known: http://:4318 is not a collector's Service",
    );
    expect(
      described(
        checkoutWith((spec) => {
          spec.exporter = undefined;
        }),
      ),
    ).toEqual({ value: "Not known: no endpoint is set, so the agent's default" });
    expect(resolveExporter(rowOf("otel-apps/checkout"), undefined)).toEqual({
      kind: "unknown",
      why: "the collectors are not read yet",
    });
  });

  it("is not known when a variable the agent reads first is set, its value unread", () => {
    const common = checkoutWith((spec) => {
      spec.env = [...(spec.env ?? []), { name: "OTEL_EXPORTER_OTLP_ENDPOINT" }];
    });
    const python = checkoutWith((spec) => {
      spec.python = { ...spec.python, env: [{ name: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT" }] };
    });
    const container = variant(workloadNamed("otel-apps/checkout"), (data) => {
      for (const each of data.spec.template.spec?.containers ?? []) {
        each.env = [...(each.env ?? []), { name: "OTEL_EXPORTER_OTLP_ENDPOINT" }];
      }
    });

    expect(described(common).value).toBe(
      "Not known: OTEL_EXPORTER_OTLP_ENDPOINT in spec.env of otel-apps/python sets it; its value is not read",
    );
    expect(described(python).value).toBe(
      "Not known: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT in spec.python.env of otel-apps/python sets it; its value is not read",
    );
    expect(
      described(rowOf("otel-apps/checkout", { ...coverageInventory(), workloads: [container] }))
        .value,
    ).toBe(
      "Not known: OTEL_EXPORTER_OTLP_ENDPOINT on container app sets it; its value is not read",
    );
  });

  it("reads a CronJob's container variables from its jobTemplate", () => {
    const nightly = variant(workloadNamed("otel-batch/nightly"), (data) => {
      for (const each of data.spec.jobTemplate?.spec?.template?.spec?.containers ?? []) {
        each.env = [...(each.env ?? []), { name: "OTEL_EXPORTER_OTLP_ENDPOINT" }];
      }
    });
    const inventory = coverageInventory();
    const workloads = inventory.workloads.map((each) =>
      keyOf(each) === "otel-batch/nightly" ? nightly : each,
    );

    expect(described(rowOf("otel-batch/nightly", { ...inventory, workloads })).value).toBe(
      "Not known: OTEL_EXPORTER_OTLP_ENDPOINT on container app sets it; its value is not read",
    );
  });

  it("is nothing for a row without an Instrumentation", () => {
    const row = rowOf("otel-apps/typo");

    expect(row.instrumentation).toBeUndefined();
    expect(
      exporterOf(row, { collectors: collectors(), pods: pods(), scope: EVERYWHERE }, NOW),
    ).toBeUndefined();
  });
});

describe("the link from where the agent exports", () => {
  const linkOf = (row: CoverageRow) => {
    const exporter = resolveExporter(row, collectors());

    return exporter && exporterLink(exporter);
  };

  it("opens the collector it names in the Collectors list", () => {
    expect(linkOf(rowOf("otel-apps/checkout"))).toEqual({
      namespace: "otel-collectors",
      name: "gateway",
      title: "Opens otel-collectors/gateway in the Collectors list",
    });
  });

  it("is none for a collector that does not exist, or an endpoint that is no collector's", () => {
    expect(linkOf(endpointed("http://gateway-collector:4318"))).toBeUndefined();
    expect(
      linkOf(
        checkoutWith((spec) => {
          spec.exporter = undefined;
        }),
      ),
    ).toBeUndefined();
  });
});

describe("reading an endpoint", () => {
  it("takes the host and port with or without a scheme and path", () => {
    expect(parseEndpoint("http://Gateway-Collector.otel-collectors:4318/v1/traces")).toEqual({
      host: "gateway-collector.otel-collectors",
      port: 4318,
    });
    expect(parseEndpoint("gateway-collector")).toEqual({ host: "gateway-collector" });
    expect(parseEndpoint("http://:4318")).toBeUndefined();
  });

  it("knows the Services the operator names after a collector", () => {
    expect(collectorOfHost("gateway-collector.otel-collectors.svc.cluster.local", "x")).toEqual({
      name: "gateway",
      namespace: "otel-collectors",
    });
    expect(collectorOfHost("gateway-collector", "otel-apps")).toEqual({
      name: "gateway",
      namespace: "otel-apps",
    });
    expect(collectorOfHost("gateway-collector-monitoring.otel-collectors", "x")).toBeUndefined();
    expect(collectorOfHost("tempo.monitoring", "x")).toBeUndefined();
  });
});

describe("a collector's OTLP ports", () => {
  const config = () =>
    collectorNamed("otel-collectors/gateway").spec.config as Record<string, unknown>;

  it("are its otlp receivers' endpoints, or the protocol's default", () => {
    expect(otlpPorts(config())).toEqual([4317, 4318]);
    const defaults = { "otlp/defaults": { protocols: { grpc: {}, http: null } } };

    expect(otlpPorts({ ...config(), receivers: defaults })).toEqual([4317, 4318]);
    expect(otlpPorts({ ...config(), receivers: { otlp: {} } })).toEqual([]);
    expect(
      otlpPorts({ ...config(), receivers: { otlp: { protocols: { grpc: { endpoint: "x" } } } } }),
    ).toEqual([]);
    expect(otlpPorts({ ...config(), receivers: undefined })).toEqual([]);
  });

  it("are not known from a config that is not an object", () => {
    expect(otlpPorts(JSON.stringify(config()))).toBeUndefined();
    expect(otlpPorts(undefined)).toBeUndefined();
  });
});
