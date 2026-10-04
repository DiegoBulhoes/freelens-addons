export interface RedisCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export type RedisKind = "Replication" | "Cluster" | "Standalone" | "Sentinel";

export interface KubernetesConfig {
  image?: string;
  redisSecret?: { name?: string; key?: string };
}

export interface RedisSpec {
  clusterSize?: number;
  clusterVersion?: string;
  kubernetesConfig?: KubernetesConfig;
  redisLeader?: { replicas?: number };
  redisFollower?: { replicas?: number };
  TLS?: { ca?: string; cert?: string; key?: string; secret?: { secretName?: string } };
  redisSentinelConfig?: {
    redisReplicationName?: string;
    masterGroupName?: string;
    redisPort?: string;
    quorum?: string;
  };
}

export interface RedisStatus {
  state?: string;
  reason?: string;
  readyLeaderReplicas?: number;
  readyFollowerReplicas?: number;
  masterNode?: string;
  connectionInfo?: { host?: string; port?: number; masterName?: string };
}

interface Named {
  getName(): string;
  getNs(): string | undefined;
  metadata: {
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    creationTimestamp?: string;
  };
}

export interface RedisLike extends Named {
  kind: string;
  spec: RedisSpec;
  status?: RedisStatus;
}

export interface ContainerState {
  running?: { startedAt?: string };
  waiting?: { reason?: string; message?: string };
  terminated?: { reason?: string; exitCode?: number; message?: string };
}

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: ContainerState;
  lastState?: ContainerState;
}

export interface PodLike extends Named {
  spec?: { nodeName?: string; containers?: { name: string }[] };
  status?: {
    phase?: string;
    startTime?: string;
    conditions?: { type: string; status: string; reason?: string; message?: string }[];
    containerStatuses?: ContainerStatus[];
  };
}

export interface PvcLike extends Named {
  spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } };
  status?: { phase?: string; capacity?: { storage?: string } };
}

export interface EventLike extends Named {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  involvedObject: { kind: string; name: string };
}

/** A Secret's metadata only, with cert-manager's annotations: its values are never read. */
export interface SecretMetaLike {
  metadata: { name: string; namespace?: string; annotations?: Record<string, string> };
}
