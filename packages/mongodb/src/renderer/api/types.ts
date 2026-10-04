export interface MongoCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export interface Role {
  name: string;
  db: string;
}

export interface UserSpec {
  name: string;
  db: string;
  passwordSecretRef?: { name: string; key?: string };
  roles?: Role[];
  scramCredentialsSecretName?: string;
  connectionStringSecretName?: string;
  connectionStringSecretNamespace?: string;
}

export interface MemberConfig {
  votes?: number;
  priority?: string;
  tags?: Record<string, string>;
}

export interface ReplicaSetSpec {
  type?: string;
  members: number;
  arbiters?: number;
  version: string;
  featureCompatibilityVersion?: string;
  memberConfig?: MemberConfig[];
  users?: UserSpec[];
  security?: {
    authentication?: { modes?: string[]; ignoreUnknownUsers?: boolean };
    tls?: {
      enabled?: boolean;
      optional?: boolean;
      certificateKeySecretRef?: { name?: string };
      caCertificateSecretRef?: { name?: string };
      caConfigMapRef?: { name?: string };
    };
  };
  prometheus?: { username?: string; port?: number };
  statefulSet?: {
    spec?: {
      template?: { metadata?: { annotations?: Record<string, string> } };
      volumeClaimTemplates?: unknown[];
    };
  };
  additionalMongodConfig?: Record<string, unknown>;
}

export interface ReplicaSetStatus {
  phase?: string;
  message?: string;
  version?: string;
  mongoUri?: string;
  currentMongoDBMembers?: number;
  currentStatefulSetReplicas?: number;
  currentMongoDBArbiters?: number;
  currentStatefulSetArbitersReplicas?: number;
}

interface Named {
  getName(): string;
  getNs(): string | undefined;
  metadata: {
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    creationTimestamp?: string;
    ownerReferences?: { kind: string; name: string }[];
  };
}

export interface ReplicaSetLike extends Named {
  spec: ReplicaSetSpec;
  status?: ReplicaSetStatus;
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
  spec?: { nodeName?: string };
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

export interface AgentStep {
  step: string;
  stepDoc?: string;
  isWaitStep?: boolean;
  started?: string | null;
  completed?: string | null;
  result?: string;
}

export interface AgentPlan {
  automationConfigVersion?: number;
  started?: string | null;
  completed?: string | null;
  moves?: { move: string; moveDoc?: string; steps?: AgentStep[] }[];
}

/** The automation agent's agent-health-status.json, as each member's agent writes it. */
export interface AgentHealth {
  statuses?: Record<
    string,
    {
      IsInGoalState?: boolean;
      LastMongoUpTime?: number;
      ExpectedToBeUp?: boolean;
      ReplicationStatus?: number;
    }
  >;
  mmsStatus?: Record<string, { lastGoalVersionAchieved?: number; plans?: AgentPlan[] | null }>;
}
