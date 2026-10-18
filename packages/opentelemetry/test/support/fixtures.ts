import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KubeObject } from "@freelensapp/kube-object";

import type { CoverageInventory } from "../../src/renderer/api/coverage/coverage";
import type {
  OperatorContainer,
  OperatorDeployment,
} from "../../src/renderer/api/coverage/operator";
import {
  type Listings,
  namesFrom,
  type PartialObjectMetadataList,
} from "../../src/renderer/api/coverage/reference-names";
import { Instrumentation, OpenTelemetryCollector } from "../../src/renderer/api/shared/kinds";
import type {
  CollectorLike,
  InstrumentationLike,
  NamespaceLike,
  PodLike,
  WorkloadLike,
} from "../../src/renderer/api/shared/types";

import collectorsJson from "../fixtures/collectors.json";
import exportedAt from "../fixtures/exported-at.json";
import instrumentationsJson from "../fixtures/instrumentations.json";
import namespacesJson from "../fixtures/namespaces.json";
import podsJson from "../fixtures/pods.json";
import secretNamesJson from "../fixtures/secret-names.json";
import workloadsJson from "../fixtures/workloads.json";

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export const NOW = Date.parse(exportedAt.exportedAt);

export const instrumentations = () =>
  build(Instrumentation, instrumentationsJson) as unknown as InstrumentationLike[];
export const collectors = () =>
  build(OpenTelemetryCollector, collectorsJson) as unknown as CollectorLike[];
export const workloads = () => build(KubeObject, workloadsJson) as unknown as WorkloadLike[];
export const pods = () => build(KubeObject, podsJson) as unknown as PodLike[];
export const namespaces = () => build(KubeObject, namespacesJson) as unknown as NamespaceLike[];

/** The Secret names listed in otel-tls, where its Instrumentation's TLS Secret is looked up. */
export const secretNames = () => namesFrom(secretNamesJson as PartialObjectMetadataList);

/** The exported otel-tls listing, as the page holds it once that namespace's names are listed. */
export const tlsListings = (): Listings => new Map([["otel-tls", secretNames()]]);

/** `names` (`namespace/name`) as each of `namespaces` would list them. */
export function listingsOf(namespaces: string[], names: string[] = []): Listings {
  return new Map(
    namespaces.map((namespace) => [
      namespace,
      new Set(names.filter((name) => name.startsWith(`${namespace}/`))),
    ]),
  );
}

/** The raw pod list: a metadata-only listing has its shape. */
export const podList = () => JSON.parse(JSON.stringify(podsJson)) as PartialObjectMetadataList;

/** The workload list filtered as the operator's label selector would: plain JSON, as the API lists it. */
export const operatorDeployments = () =>
  (JSON.parse(JSON.stringify(workloadsJson)) as { items: OperatorDeployment[] }).items.filter(
    (item) =>
      (item.metadata as { labels?: Record<string, string> }).labels?.["app.kubernetes.io/name"] ===
      "opentelemetry-operator",
  );

/** The operator's list with its manager container changed. */
export function operatorWith(change: (manager: OperatorContainer) => void): {
  items: OperatorDeployment[];
} {
  const items = operatorDeployments();

  for (const container of items.flatMap((item) => item.spec?.template?.spec?.containers ?? [])) {
    change(container);
  }

  return { items };
}

export function coverageInventory(): CoverageInventory {
  return {
    workloads: workloads(),
    pods: pods(),
    namespaces: namespaces(),
    instrumentations: instrumentations(),
    collectors: collectors(),
    references: { secrets: tlsListings() },
    operator: { items: operatorDeployments() },
  };
}

function named<T extends { getName(): string; getNs(): string | undefined }>(
  items: T[],
  key: string,
): T {
  const found = items.find((each) => `${each.getNs() ?? ""}/${each.getName()}` === key);

  if (!found) throw new Error(`no ${key} in the fixture`);

  return found;
}

export const workloadNamed = (key: string) => named(workloads(), key);
export const collectorNamed = (key: string) => named(collectors(), key);
export const instrumentationNamed = (key: string) => named(instrumentations(), key);
export const namespaceNamed = (name: string) => named(namespaces(), `/${name}`);

/** The seed's sample pods carry `app: <workload>`, the operator's collectors their instance label. */
export function podOf(namespace: string, app: string): PodLike {
  const found = pods().find(
    (pod) =>
      pod.getNs() === namespace &&
      (pod.metadata.labels?.app === app ||
        pod.metadata.labels?.["app.kubernetes.io/instance"] === `${namespace}.${app}`),
  );

  if (!found) throw new Error(`no pod of ${namespace}/${app} in the fixture`);

  return found;
}

export const collectorLog = () =>
  readFileSync(resolve(__dirname, "../fixtures/collector-log.txt"), "utf8");

/** A real object, deep-cloned, with only the field under test changed. */
export function variant<T>(object: T, change: (data: T) => void): T {
  const data = (object as unknown as KubeObject).toPlainObject() as unknown as T;

  change(data);

  const Kind = (object as unknown as { constructor: new (data: T) => T }).constructor;

  return new Kind(data);
}

/** broken's pod with its last exit as its state and no back-off, whatever phase the export caught. */
export const exitedCollectorPod = () =>
  variant(podOf("otel-collectors", "broken"), (data) => {
    data.status = {
      ...data.status,
      containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
        ...status,
        state: { terminated: status.state?.terminated ?? status.lastState?.terminated },
      })),
    };
  });
