import { hasReadyCondition, keyOf, runningContainers } from "../shared/pods";
import {
  matchesSelector,
  monitorTargetNamespaces,
  namespaceOf,
  type TargetNamespaces,
} from "../shared/selectors";
import type {
  EndpointSliceLike,
  MonitorKind,
  MonitorLike,
  Named,
  PodLike,
  PodMetricsEndpoint,
  ServiceLike,
} from "../shared/types";

export type CheckState = "ok" | "no-target" | "port-missing" | "no-endpoints" | "unchecked";

/** What one endpoint of a monitor reaches in Kubernetes, before Prometheus is asked. */
export interface EndpointCheck {
  index: number;
  /** The port name asked for, or a number for a PodMonitor's portNumber. */
  port: string | undefined;
  /** namespace/name of the matched Services or pods. */
  targets: string[];
  /** Port names the matched objects offer, for the fix. */
  portNames: string[];
  /** namespace/name of the matched objects that carry the port. */
  withPort: string[];
  /** Endpoints (ServiceMonitor) or pods with an IP (PodMonitor) on that port: what Prometheus scrapes. */
  addresses: number;
  /** How many of those are Ready; shown only, since unready ones are scraped too. */
  ready: number;
  state: CheckState;
}

const unique = (values: string[]) => [...new Set(values)];

const defaultNamespaces = (monitor: MonitorLike): TargetNamespaces =>
  monitorTargetNamespaces(monitor.spec.namespaceSelector, namespaceOf(monitor));

const selectedBy = <T extends Named>(monitor: MonitorLike, objects: T[]) =>
  objects.filter((object) => matchesSelector(monitor.spec.selector, object.metadata.labels));

export function portNameFound(service: ServiceLike, port: string): boolean {
  return (service.spec.ports ?? []).some((each) => each.name === port);
}

/** Endpoints behind a Service's named port, read from its EndpointSlices; ready unset means ready. */
export function endpointCounts(
  slices: EndpointSliceLike[],
  service: ServiceLike,
  port: string,
): { addresses: number; ready: number } {
  const endpoints = slices
    .filter(
      (slice) =>
        slice.getNs() === service.getNs() &&
        slice.metadata.labels?.["kubernetes.io/service-name"] === service.getName() &&
        (slice.ports ?? []).some((each) => each.name === port),
    )
    .flatMap((slice) => slice.endpoints ?? []);

  return {
    addresses: endpoints.length,
    ready: endpoints.filter((each) => each.conditions?.ready !== false).length,
  };
}

// The operator drops Failed and Succeeded pods unless the endpoint sets filterRunning: false.
const isScraped = (pod: PodLike, endpoint: PodMetricsEndpoint) =>
  endpoint.filterRunning === false ||
  (pod.status?.phase !== "Failed" && pod.status?.phase !== "Succeeded");

const containerPorts = (pod: PodLike) =>
  runningContainers(pod).flatMap((container) => container.ports ?? []);

function stateOf(check: Omit<EndpointCheck, "state">): CheckState {
  if (check.port === undefined) return "unchecked";
  if (check.targets.length === 0) return "no-target";
  if (check.withPort.length === 0) return "port-missing";

  return check.addresses > 0 ? "ok" : "no-endpoints";
}

export interface KubernetesObjects {
  services: ServiceLike[];
  endpointSlices: EndpointSliceLike[];
  pods: PodLike[];
}

/** The objects grouped once, so each monitor reads only its own namespaces and Services. */
export interface ObjectIndex {
  servicesIn(namespaces: TargetNamespaces): ServiceLike[];
  podsIn(namespaces: TargetNamespaces): PodLike[];
  slicesOf(service: ServiceLike): EndpointSliceLike[];
}

function groupBy<T>(items: T[], keyOf: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);

    if (key === undefined) continue;

    const group = groups.get(key);

    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return groups;
}

function namespacedIndex<T extends Named>(items: T[]) {
  const byNamespace = groupBy(items, namespaceOf);

  return (namespaces: TargetNamespaces): T[] => {
    if (namespaces.any) return items;

    const names = new Set(namespaces.names);

    // Several namespaces are rare and keep the list's order.
    if (names.size !== 1) return items.filter((item) => names.has(namespaceOf(item)));

    return byNamespace.get(namespaces.names[0] as string) ?? [];
  };
}

export function indexObjects(objects: KubernetesObjects): ObjectIndex {
  const slices = groupBy(objects.endpointSlices, (slice) => {
    const service = slice.metadata.labels?.["kubernetes.io/service-name"];

    return service === undefined ? undefined : `${namespaceOf(slice)}/${service}`;
  });

  return {
    servicesIn: namespacedIndex(objects.services),
    podsIn: namespacedIndex(objects.pods),
    slicesOf: (service) => slices.get(keyOf(service)) ?? [],
  };
}

function serviceChecks(
  monitor: MonitorLike,
  objects: ObjectIndex,
  namespaces: TargetNamespaces,
): EndpointCheck[] {
  const services = selectedBy(monitor, objects.servicesIn(namespaces));

  return (monitor.spec.endpoints ?? []).map((endpoint, index) => {
    // targetPort alone is deprecated and names a container port, which a Service does not list.
    const port = endpoint.port;
    const withPort = port ? services.filter((service) => portNameFound(service, port)) : [];
    const counts = port
      ? withPort.map((service) => endpointCounts(objects.slicesOf(service), service, port))
      : [];
    const check = {
      index,
      port,
      targets: services.map(keyOf),
      portNames: unique(
        services.flatMap((service) =>
          (service.spec.ports ?? []).flatMap((each) => each.name ?? []),
        ),
      ),
      withPort: withPort.map(keyOf),
      addresses: counts.reduce((sum, each) => sum + each.addresses, 0),
      ready: counts.reduce((sum, each) => sum + each.ready, 0),
    };

    return { ...check, state: stateOf(check) };
  });
}

function podChecks(
  monitor: MonitorLike,
  objects: ObjectIndex,
  namespaces: TargetNamespaces,
): EndpointCheck[] {
  const matched = selectedBy(monitor, objects.podsIn(namespaces));

  return (monitor.spec.podMetricsEndpoints ?? []).map((endpoint, index) => {
    const pods = matched.filter((pod) => isScraped(pod, endpoint));
    const port =
      endpoint.port ??
      (endpoint.portNumber !== undefined ? String(endpoint.portNumber) : undefined);
    const carries = (pod: PodLike) =>
      containerPorts(pod).some((each) =>
        endpoint.port ? each.name === endpoint.port : each.containerPort === endpoint.portNumber,
      );
    const withPort = port ? pods.filter(carries) : [];
    const check = {
      index,
      port,
      targets: pods.map(keyOf),
      portNames: unique(
        pods.flatMap((pod) => containerPorts(pod).flatMap((each) => each.name ?? [])),
      ),
      withPort: withPort.map(keyOf),
      addresses: withPort.filter((pod) => pod.status?.podIP).length,
      ready: withPort.filter(hasReadyCondition).length,
    };

    return { ...check, state: stateOf(check) };
  });
}

/** One check per endpoint; a ScrapeConfig names its targets itself, so it has none. */
export function kubernetesChecks(
  kind: MonitorKind,
  monitor: MonitorLike,
  objects: KubernetesObjects,
  namespaces = defaultNamespaces(monitor),
  index?: ObjectIndex,
): EndpointCheck[] {
  if (kind === "ScrapeConfig") return [];

  const indexed = index ?? indexObjects(objects);

  return kind === "ServiceMonitor"
    ? serviceChecks(monitor, indexed, namespaces)
    : podChecks(monitor, indexed, namespaces);
}

const CHECK_RANK: Record<CheckState, number> = {
  "no-target": 0,
  "port-missing": 1,
  "no-endpoints": 2,
  ok: 3,
  unchecked: 4,
};

export function worstCheck(checks: EndpointCheck[]): EndpointCheck | undefined {
  return [...checks].sort((a, b) => CHECK_RANK[a.state] - CHECK_RANK[b.state])[0];
}
