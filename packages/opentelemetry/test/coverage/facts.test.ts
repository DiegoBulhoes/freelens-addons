import { describe, expect, it } from "vitest";

import { collectorRows } from "../../src/renderer/api/collectors/collectors";
import { type CoverageRow, coverageRows } from "../../src/renderer/api/coverage/coverage";
import {
  collectorFacts,
  describeContainers,
  describeResolution,
  instrumentationFacts,
  languageFacts,
} from "../../src/renderer/api/coverage/facts";
import type { CollectorLike, WorkloadLike } from "../../src/renderer/api/shared/types";
import {
  collectorNamed,
  coverageInventory,
  instrumentationNamed,
  NOW,
  pods,
  variant,
  workloads,
} from "../support/fixtures";

const KEY = "instrumentation.opentelemetry.io/inject-python";

const rowOf = (key: string, workloadList: WorkloadLike[] = workloads()): CoverageRow => {
  const found = coverageRows({ ...coverageInventory(), workloads: workloadList }).find(
    (row) => `${row.namespace}/${row.name}` === key,
  );

  if (!found) throw new Error(`no row for ${key}`);

  return found;
};

const factsOf = (key: string) => {
  const row = rowOf(key);
  const [language] = row.languages;

  if (!language) throw new Error(`no language for ${key}`);

  return languageFacts(row, language);
};
const termsOf = (key: string) =>
  Object.fromEntries(factsOf(key).map(({ term, value }) => [term, value]));

const replacing = (key: string, change: (data: WorkloadLike) => void) =>
  workloads().map((each) =>
    `${each.getNs()}/${each.getName()}` === key ? variant(each, change) : each,
  );

describe("where an opt-in comes from and what it resolves to", () => {
  it("reads checkout's from its pod template, resolved as the only Instrumentation there", () => {
    expect(factsOf("otel-apps/checkout")).toEqual([
      { term: "Language", value: "Python" },
      { term: "Opted in by", value: "The pod template" },
      { term: "Annotation", value: `${KEY}: "true" on the pod template` },
      { term: "Resolves to", value: "otel-apps/python, the only one in its namespace" },
      { term: "Operator", value: "Injects it: --enable-python-instrumentation is on by default" },
    ]);
  });

  it("names the Namespace, the value it overrides and a name it resolves by", () => {
    expect(termsOf("otel-namespace/inherited")["Opted in by"]).toBe("Namespace otel-namespace");
    expect(termsOf("otel-namespace/opted-out")).toMatchObject({
      Annotation: `${KEY}: "false" on the pod template, "true" on the Namespace`,
      "Resolves to": "Nothing: it opts out",
    });
    expect(termsOf("otel-apps/ledger")["Resolves to"]).toBe("otel-apps/python, by name");
  });

  it("says a misplaced key is never read, and why the others resolve to nothing", () => {
    expect(termsOf("otel-apps/misplaced")).toMatchObject({
      "Opted in by": "The Deployment's own annotations, which the operator never reads",
      Annotation: `${KEY}: "true" on the Deployment`,
    });
    expect(termsOf("otel-apps/typo")["Resolves to"]).toBe(
      "Nothing: otel-apps/absent does not exist",
    );
    expect(termsOf("otel-orphan/orphan")["Resolves to"]).toBe(
      "Nothing: no Instrumentation in otel-orphan",
    );
    expect(termsOf("otel-ambiguous/ambiguous")["Resolves to"]).toBe(
      "Nothing: 2 candidates in otel-ambiguous (python-a, python-b)",
    );
  });

  it("says the operator's switch is being checked before its Deployment is read", () => {
    const row = coverageRows({ ...coverageInventory(), operator: undefined }).find(
      (each) => each.name === "late",
    );
    const [language] = row?.languages ?? [];

    expect(row && language && languageFacts(row, language).at(-1)).toEqual({
      term: "Operator",
      value: "Checking: the operator's Deployment is not read yet",
    });
  });

  it("describes a resolution on its own", () => {
    expect(describeResolution({ kind: "off" })).toBe("Nothing: it opts out");
    expect(describeResolution({ kind: "unread", namespace: "otel-late" })).toBe(
      "Not known: the Instrumentations for otel-late are not read",
    );
  });
});

describe("the container the agent goes into", () => {
  it("is the one the pods show once injected", () => {
    expect(describeContainers(rowOf("otel-apps/checkout"))).toBe("app");
  });

  it("is predicted, with where the name comes from, before any pod has it", () => {
    expect(describeContainers(rowOf("otel-late/late"))).toBe("Would be app, its first container");

    const named = replacing("otel-late/late", (data) => {
      data.spec.template.metadata = {
        ...data.spec.template.metadata,
        annotations: { "instrumentation.opentelemetry.io/container-names": "app" },
      };
    });

    expect(describeContainers(rowOf("otel-late/late", named))).toBe(
      "Would be app, named by a container-names annotation",
    );
  });

  it("is none for a template with no container", () => {
    const empty = replacing("otel-late/late", (data) => {
      data.spec.template.spec = { ...data.spec.template.spec, containers: [] };
    });

    expect(describeContainers(rowOf("otel-late/late", empty))).toBe(
      "None: the pod template has no container",
    );
  });
});

describe("what the resolved Instrumentation sets", () => {
  it("reads otel-apps/python's endpoint, sampler and propagators", () => {
    expect(instrumentationFacts(instrumentationNamed("otel-apps/python"))).toEqual([
      {
        term: "Endpoint",
        value: "http://gateway-collector.otel-collectors.svc.cluster.local:4318",
      },
      { term: "Sampler", value: "parentbased_traceidratio (1)" },
      { term: "Propagators", value: "tracecontext, baggage" },
    ]);
  });

  it("falls back to the agent's defaults for what it leaves unset", () => {
    const bare = variant(instrumentationNamed("otel-apps/python"), (data) => {
      data.spec = { sampler: { type: "always_on" } };
    });

    expect(instrumentationFacts(bare).map(({ value }) => value)).toEqual([
      "Not set: the agent's default",
      "always_on",
      "Not set: the agent's default",
    ]);
    const none = variant(bare, (data) => {
      data.spec = {};
    });

    expect(instrumentationFacts(none)[1]?.value).toBe("Not set: the agent's default");
  });
});

describe("a collector's facts", () => {
  const factsFor = (collector: CollectorLike) => {
    const [row] = collectorRows([collector], pods(), new Map(), NOW);

    if (!row) throw new Error("no row");

    return Object.fromEntries(collectorFacts(row).map(({ term, value }) => [term, value]));
  };

  it("reads gateway's mode, pods, version and settings", () => {
    const facts = factsFor(collectorNamed("otel-collectors/gateway"));

    expect(facts).toMatchObject({
      Mode: "deployment",
      Pods: "1 of 1 ready; the operator reports 1/1",
      Version: "0.158.0",
      Management: "managed",
      "Upgrade strategy": "automatic",
      "Target allocator": "Off",
      Metrics: "enableMetrics: Off, prometheusCR: Off",
    });
    expect(facts.Image).toMatch(/opentelemetry-collector:0\.158\.0$/);
  });

  it("says what it lacks before the operator writes a status, and a sidecar's pods", () => {
    const sidecar = variant(collectorNamed("otel-collectors/gateway"), (data) => {
      data.spec = {
        ...data.spec,
        mode: "sidecar",
        upgradeStrategy: undefined,
        targetAllocator: { enabled: true, prometheusCR: { enabled: true } },
        observability: { metrics: { enableMetrics: true } },
      };
      data.status = undefined;
    });

    expect(factsFor(sidecar)).toMatchObject({
      Mode: "sidecar",
      Pods: "0 carrying it as a sidecar",
      Version: "—",
      Image: "—",
      "Upgrade strategy": "automatic",
      "Target allocator": "On",
      Metrics: "enableMetrics: On, prometheusCR: On",
    });
  });

  it("reads the pods without the operator's count when it reports none", () => {
    const quiet = variant(collectorNamed("otel-collectors/gateway"), (data) => {
      data.status = { ...data.status, scale: { ...data.status?.scale, statusReplicas: undefined } };
    });

    expect(factsFor(quiet).Pods).toBe("1 of 1 ready");
  });

  it("names the image the spec asks for while the status has none", () => {
    const asked = variant(collectorNamed("otel-collectors/gateway"), (data) => {
      data.spec = { ...data.spec, image: "otel/opentelemetry-collector-contrib:0.158.0" };
      data.status = { ...data.status, image: undefined };
    });

    expect(factsFor(asked).Image).toBe("otel/opentelemetry-collector-contrib:0.158.0");
  });
});
