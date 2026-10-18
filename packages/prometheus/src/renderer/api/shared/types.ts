export interface MonitoringCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export type Labels = Record<string, string | undefined>;

export interface LabelSelectorRequirement {
  key: string;
  operator: string;
  values?: string[];
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: LabelSelectorRequirement[];
}

/** The monitor's own `spec.namespaceSelector`, where its targets are looked for. */
export interface MonitorNamespaceSelector {
  any?: boolean;
  matchNames?: string[];
}

export interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface OwnerReference {
  kind: string;
  name: string;
}

export interface Named {
  getName(): string;
  getNs(): string | undefined;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    labels?: Labels;
    annotations?: Record<string, string>;
    ownerReferences?: OwnerReference[];
    creationTimestamp?: string;
  };
}

/** Present only when the operator's StatusForConfigurationResources gate is on. */
export interface Binding {
  group?: string;
  resource?: string;
  name?: string;
  namespace?: string;
  conditions?: Condition[];
}

export interface ServiceMonitorEndpoint {
  port?: string;
  targetPort?: string | number;
  path?: string;
  scheme?: string;
  interval?: string;
  scrapeTimeout?: string;
}

export interface PodMetricsEndpoint {
  port?: string;
  portNumber?: number;
  targetPort?: string | number;
  filterRunning?: boolean;
  path?: string;
  interval?: string;
  scrapeTimeout?: string;
}

/** `params`, `proxyUrl`, credentials and TLS are never read: the fixtures redact them. */
export interface MonitorSpec {
  selector?: LabelSelector | null;
  namespaceSelector?: MonitorNamespaceSelector;
  endpoints?: ServiceMonitorEndpoint[];
  podMetricsEndpoints?: PodMetricsEndpoint[];
  staticConfigs?: { targets?: string[] }[];
  jobName?: string;
}

export type MonitorKind = "ServiceMonitor" | "PodMonitor" | "ScrapeConfig";

export interface MonitorLike extends Named {
  kind: string;
  spec: MonitorSpec;
  status?: { bindings?: Binding[] };
}

export interface RuleSpec {
  groups?: {
    name: string;
    interval?: string;
    rules?: { alert?: string; record?: string; expr?: string | number }[];
  }[];
}

export interface RuleLike extends Named {
  spec: RuleSpec;
  status?: { bindings?: Binding[] };
}

/** `remoteWrite`, `additionalScrapeConfigs` and credentials are never read. */
export interface PrometheusSpec {
  paused?: boolean;
  /** A PrometheusAgent's "StatefulSet" (the default) or "DaemonSet". */
  mode?: string;
  replicas?: number;
  shards?: number;
  version?: string;
  image?: string;
  portName?: string;
  routePrefix?: string;
  web?: { tlsConfig?: object | null };
  ignoreNamespaceSelectors?: boolean;
  serviceDiscoveryRole?: string;
  serviceMonitorSelector?: LabelSelector | null;
  serviceMonitorNamespaceSelector?: LabelSelector | null;
  podMonitorSelector?: LabelSelector | null;
  podMonitorNamespaceSelector?: LabelSelector | null;
  scrapeConfigSelector?: LabelSelector | null;
  scrapeConfigNamespaceSelector?: LabelSelector | null;
  ruleSelector?: LabelSelector | null;
  ruleNamespaceSelector?: LabelSelector | null;
  alerting?: { alertmanagers?: { name: string; namespace?: string; port?: string | number }[] };
  retention?: string;
}

export interface ShardStatus {
  shardID: string;
  replicas?: number;
  availableReplicas?: number;
  unavailableReplicas?: number;
  updatedReplicas?: number;
}

export interface InstanceStatus {
  paused?: boolean;
  replicas?: number;
  availableReplicas?: number;
  unavailableReplicas?: number;
  updatedReplicas?: number;
  shards?: number;
  conditions?: Condition[];
  shardStatuses?: ShardStatus[];
}

export interface PrometheusLike extends Named {
  kind: string;
  spec: PrometheusSpec;
  status?: InstanceStatus;
}

export interface AlertmanagerLike extends Named {
  kind: string;
  spec: { paused?: boolean; replicas?: number; version?: string; portName?: string };
  status?: InstanceStatus;
}

export interface TargetAllocatorSpec {
  enabled?: boolean;
  allocationStrategy?: string;
  prometheusCR?: {
    enabled?: boolean;
    allowNamespaces?: string[];
    denyNamespaces?: string[];
    serviceMonitorSelector?: LabelSelector | null;
    serviceMonitorNamespaceSelector?: LabelSelector | null;
    podMonitorSelector?: LabelSelector | null;
    podMonitorNamespaceSelector?: LabelSelector | null;
    scrapeConfigSelector?: LabelSelector | null;
    scrapeConfigNamespaceSelector?: LabelSelector | null;
  };
}

export interface CollectorLike extends Named {
  spec: { mode?: string; targetAllocator?: TargetAllocatorSpec };
}

export interface ServicePort {
  name?: string;
  port: number;
  targetPort?: string | number;
}

export interface ServiceLike extends Named {
  spec: { ports?: ServicePort[]; selector?: Record<string, string> };
}

export interface EndpointSliceLike extends Named {
  ports?: { name?: string; port?: number }[] | null;
  endpoints?: { conditions?: { ready?: boolean | null }; targetRef?: { name?: string } }[] | null;
}

export interface ResourceList {
  cpu?: string;
  memory?: string;
  storage?: string;
}

export interface ContainerSpec {
  name: string;
  restartPolicy?: string;
  ports?: { name?: string; containerPort: number }[];
  resources?: { requests?: ResourceList; limits?: ResourceList };
}

export interface PodLike extends Named {
  spec?: {
    nodeName?: string;
    hostNetwork?: boolean;
    containers?: ContainerSpec[];
    initContainers?: ContainerSpec[];
    volumes?: { name: string; persistentVolumeClaim?: { claimName: string } }[];
  };
  status?: { phase?: string; podIP?: string; conditions?: Condition[] };
}

export type NamespaceLike = Named;

export interface NodeLike extends Named {
  status?: {
    capacity?: ResourceList;
    allocatable?: ResourceList;
    conditions?: Condition[];
    addresses?: { type: string; address: string }[];
  };
}

export interface PvcLike extends Named {
  spec?: { resources?: { requests?: ResourceList } };
  status?: { phase?: string; capacity?: ResourceList };
}

/** Core v1 Events name `involvedObject`; events.k8s.io names it `regarding` and the text `note`. */
export interface EventLike {
  reason?: string;
  message?: string;
  note?: string;
  involvedObject?: { kind?: string; name?: string; namespace?: string; uid?: string };
  regarding?: { kind?: string; name?: string; namespace?: string; uid?: string };
  eventTime?: string | null;
  lastTimestamp?: string | null;
  metadata?: { creationTimestamp?: string };
}

/** `discoveredLabels` and `globalUrl` are never kept: they carry pod annotations and addresses. */
export interface Target {
  scrapePool: string;
  labels: Record<string, string>;
  scrapeUrl: string;
  health: "up" | "down" | "unknown";
  lastError: string;
  lastScrape?: string;
  scrapeInterval?: string;
}

export interface Alert {
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  state: "firing" | "pending" | "inactive" | string;
  activeAt?: string;
  value?: string;
}

export interface LiveRule {
  name: string;
  type: "alerting" | "recording";
  health?: string;
  lastError?: string;
  state?: string;
  alerts?: Alert[];
}

export interface RuleGroup {
  name: string;
  file: string;
  rules: LiveRule[];
}

/** The host's MetricData: what requestMetrics resolves to, `{}` when the query failed. */
export interface MetricResult {
  metric: Record<string, string | undefined>;
  values: [number, string][];
}

export interface MetricData {
  status?: string;
  /** Set by askInTurn when the read threw, as Prometheus sets it on a refused query. */
  error?: string;
  data?: { resultType?: string; result?: MetricResult[] };
}

export interface QueryRange {
  start: number;
  end: number;
  step: number;
}
