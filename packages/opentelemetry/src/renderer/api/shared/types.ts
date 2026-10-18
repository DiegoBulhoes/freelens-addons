export interface OtelCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export interface EnvName {
  name: string;
  valueFrom?: unknown;
}

export interface LanguageSpec {
  image?: string;
  env?: EnvName[];
}

/** Values of `env` are never read: the fixtures blank them. */
export interface InstrumentationSpec {
  exporter?: {
    endpoint?: string;
    tls?: { secretName?: string; configMapName?: string };
  };
  propagators?: string[];
  sampler?: { type?: string; argument?: string };
  env?: EnvName[];
  java?: LanguageSpec;
  nodejs?: LanguageSpec;
  python?: LanguageSpec;
  dotnet?: LanguageSpec;
  go?: LanguageSpec;
  apacheHttpd?: LanguageSpec;
  nginx?: LanguageSpec;
  defaults?: { useLabelsForResourceAttributes?: boolean };
}

export interface InstrumentationStatus {
  upgradeBlockedVersions?: Record<string, string>;
}

export type CollectorMode = "daemonset" | "deployment" | "sidecar" | "statefulset";

export interface CollectorSpec {
  mode?: CollectorMode;
  managementState?: "managed" | "unmanaged";
  upgradeStrategy?: string;
  replicas?: number;
  image?: string;
  targetAllocator?: {
    enabled?: boolean;
    replicas?: number;
    prometheusCR?: { enabled?: boolean };
  };
  observability?: { metrics?: { enableMetrics?: boolean } };
  config?: unknown;
}

export interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export interface CollectorStatus {
  scale?: { replicas?: number; selector?: string; statusReplicas?: string };
  version?: string;
  image?: string;
  conditions?: Condition[];
}

export interface OwnerReference {
  kind: string;
  name: string;
}

interface Named {
  getName(): string;
  getNs(): string | undefined;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: OwnerReference[];
    creationTimestamp?: string;
    deletionTimestamp?: string;
  };
}

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet" | "CronJob" | "Job";

export interface ContainerSpec {
  name: string;
  env?: EnvName[];
  restartPolicy?: string;
}

export interface PodTemplate {
  metadata?: { annotations?: Record<string, string>; labels?: Record<string, string> };
  spec?: { containers?: ContainerSpec[] };
}

export interface WorkloadLike extends Named {
  kind: string;
  spec: {
    replicas?: number;
    paused?: boolean;
    updateStrategy?: { type?: string; rollingUpdate?: { partition?: number } };
    selector?: { matchLabels?: Record<string, string> };
    /** Absent on a CronJob, whose pods come from jobTemplate: read podTemplateOf. */
    template: PodTemplate;
    jobTemplate?: { spec?: { template?: PodTemplate } };
  };
}

export interface ContainerState {
  running?: { startedAt?: string };
  waiting?: { reason?: string; message?: string };
  terminated?: { reason?: string; exitCode?: number; finishedAt?: string };
}

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: ContainerState;
  lastState?: ContainerState;
}

export interface PodLike extends Named {
  spec?: { containers?: ContainerSpec[]; initContainers?: ContainerSpec[] };
  status?: {
    phase?: string;
    startTime?: string;
    conditions?: Condition[];
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}

export type NamespaceLike = Named;

export interface InstrumentationLike extends Named {
  spec: InstrumentationSpec;
  status?: InstrumentationStatus;
}

export interface CollectorLike extends Named {
  spec: CollectorSpec;
  status?: CollectorStatus;
}
