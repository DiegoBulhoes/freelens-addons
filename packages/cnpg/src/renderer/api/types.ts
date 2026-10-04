export interface CnpgCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export interface Condition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface PluginConfiguration {
  name: string;
  enabled?: boolean;
  isWALArchiver?: boolean;
  parameters?: Record<string, string>;
}

export interface ClusterSpec {
  instances: number;
  managed?: { roles?: { name: string; ensure?: string }[] };
  tablespaces?: { name: string }[];
  nodeMaintenanceWindow?: { inProgress?: boolean; reusePVC?: boolean };
  monitoring?: { tls?: { enabled?: boolean } };
  imageName?: string;
  plugins?: PluginConfiguration[];
  backup?: {
    barmanObjectStore?: { destinationPath?: string };
    volumeSnapshot?: { className?: string };
  };
  certificates?: CertificateNames;
  bootstrap?: { initdb?: { database?: string; owner?: string } };
}

export interface CertificateNames {
  serverTLSSecret?: string;
  serverCASecret?: string;
  clientCASecret?: string;
  replicationTLSSecret?: string;
}

/** A Secret's metadata only, with cert-manager's annotations: its values are never read. */
export interface SecretMetaLike {
  metadata: { name: string; namespace?: string; annotations?: Record<string, string> };
}

export interface ReportedInstance {
  isPrimary?: boolean;
  timeLineID?: number;
}

export interface ClusterStatus {
  phase?: string;
  phaseReason?: string;
  instances?: number;
  readyInstances?: number;
  currentPrimary?: string;
  targetPrimary?: string;
  currentPrimaryTimestamp?: string;
  timelineID?: number;
  instanceNames?: string[];
  instancesStatus?: Record<string, string[]>;
  instancesReportedState?: Record<string, ReportedInstance>;
  firstRecoverabilityPoint?: string;
  lastSuccessfulBackup?: string;
  lastFailedBackup?: string;
  image?: string;
  conditions?: Condition[];
  certificates?: CertificateNames & { expirations?: Record<string, string> };
  danglingPVC?: string[];
  unusablePVC?: string[];
  initializingPVC?: string[];
  systemID?: string;
  pgDataImageInfo?: { image?: string; majorVersion?: number };
  managedRolesStatus?: {
    byStatus?: Record<string, string[]>;
    cannotReconcile?: Record<string, string[]>;
  };
  tablespacesStatus?: { name: string; owner?: string; state?: string; error?: string }[];
}

export type BackupMethod = "plugin" | "barmanObjectStore" | "volumeSnapshot";

export interface BackupSpec {
  cluster: { name: string };
  method?: BackupMethod;
  pluginConfiguration?: { name: string };
}

export interface BackupStatus {
  phase?: string;
  error?: string;
  method?: string;
  startedAt?: string;
  stoppedAt?: string;
  reconciliationStartedAt?: string;
  reconciliationTerminatedAt?: string;
  backupId?: string;
  backupName?: string;
  beginWal?: string;
  endWal?: string;
  beginLSN?: string;
  endLSN?: string;
  online?: boolean;
  majorVersion?: number;
  instanceID?: { podName?: string };
}

export interface ScheduledBackupSpec {
  cluster: { name: string };
  schedule: string;
  suspend?: boolean;
  immediate?: boolean;
  method?: BackupMethod;
  pluginConfiguration?: { name: string };
}

export interface ScheduledBackupStatus {
  lastCheckTime?: string;
  lastScheduleTime?: string;
  nextScheduleTime?: string;
}

export interface PoolerSpec {
  cluster: { name: string };
  instances?: number;
  type?: "rw" | "ro" | "r";
  pgbouncer?: { poolMode?: string; paused?: boolean; parameters?: Record<string, string> };
}

export interface PoolerStatus {
  image?: string;
  phase?: string;
  phaseReason?: string;
  instances?: number;
}

export interface RecoveryWindow {
  firstRecoverabilityPoint?: string;
  lastSuccessfulBackupTime?: string;
  lastFailedBackupTime?: string;
}

export interface ObjectStoreSpec {
  configuration?: { destinationPath?: string; endpointURL?: string };
  retentionPolicy?: string;
}

export interface ObjectStoreStatus {
  serverRecoveryWindow?: Record<string, RecoveryWindow>;
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

export interface ClusterLike extends Named {
  spec: ClusterSpec;
  status?: ClusterStatus;
}

export interface BackupLike extends Named {
  spec: BackupSpec;
  status?: BackupStatus;
}

export interface ScheduledBackupLike extends Named {
  spec: ScheduledBackupSpec;
  status?: ScheduledBackupStatus;
}

export interface PoolerLike extends Named {
  spec: PoolerSpec;
  status?: PoolerStatus;
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

export interface PodLike extends Named {
  spec?: { nodeName?: string };
  status?: { conditions?: { type: string; status: string }[]; qosClass?: string };
}

export interface ObjectStoreLike extends Named {
  spec: ObjectStoreSpec;
  status?: ObjectStoreStatus;
}

export interface PodDisruptionBudgetLike extends Named {
  spec: { minAvailable?: number | string; maxUnavailable?: number | string };
  status?: {
    expectedPods?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
    disruptionsAllowed?: number;
  };
}

export interface ReplicationTarget {
  name: string;
  namespace?: string;
}

export interface PublicationLike extends Named {
  spec: {
    cluster: { name: string };
    dbname: string;
    name: string;
    target?: { allTables?: boolean; objects?: unknown[] };
    publicationReclaimPolicy?: string;
  };
  status?: { applied?: boolean; message?: string };
}

export interface SubscriptionLike extends Named {
  spec: {
    cluster: { name: string };
    dbname: string;
    name: string;
    publicationName: string;
    externalClusterName: string;
    subscriptionReclaimPolicy?: string;
  };
  status?: { applied?: boolean; message?: string };
}

export interface ReplicationInfo {
  applicationName: string;
  state?: string;
  replayLsn?: string;
  replayLag?: string;
  syncState?: string;
}

export interface SlotInfo {
  slotName: string;
  slotType?: string;
  database?: string;
  restartLsn?: string;
  walStatus?: string;
  active?: boolean;
}

/** What the instance manager answers on /pg/status, as `kubectl cnpg status` reads it. */
export interface InstanceStatus {
  isPrimary?: boolean;
  currentLsn?: string;
  receivedLsn?: string;
  replayLsn?: string;
  replayPaused?: boolean;
  pendingRestart?: boolean;
  isArchivingWAL?: boolean;
  lastArchivedWALTime?: string;
  lastFailedWAL?: string;
  lastFailedWALTime?: string;
  timeLineID?: number;
  replicationInfo?: ReplicationInfo[];
  replicationSlotsInfo?: SlotInfo[];
}
