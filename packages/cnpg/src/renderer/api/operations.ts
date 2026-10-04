import { backupConfig } from "./backups";
import {
  HEALTHY_PHASE,
  HIBERNATION_ANNOTATION,
  isHibernated,
  replicaNames,
  replicasOf,
} from "./clusters";
import type { BackupLike, BackupMethod, ClusterLike, PodLike, ScheduledBackupLike } from "./types";

export const RESTART_ANNOTATION = "kubectl.kubernetes.io/restartedAt";
export const RELOAD_ANNOTATION = "cnpg.io/reloadedAt";

export interface BackupManifest {
  apiVersion: "postgresql.cnpg.io/v1";
  kind: "Backup";
  metadata: { name: string; namespace: string };
  spec: {
    cluster: { name: string };
    method: string;
    pluginConfiguration?: { name: string };
    target?: BackupTarget;
    online?: boolean;
    onlineConfiguration?: { immediateCheckpoint?: boolean; waitForArchive?: boolean };
  };
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export type BackupTarget = "primary" | "prefer-standby";

export interface BackupOptions {
  method?: BackupMethod;
  target?: BackupTarget;
  /** Volume snapshots only: false stops Postgres on the instance for a cold copy. */
  online?: boolean;
  immediateCheckpoint?: boolean;
  /** The operator waits by default; false stops it waiting for the closing WAL. */
  waitForArchive?: boolean;
}

/** These three exist for volume snapshots; other methods are always online. */
export function snapshotSettings(options: BackupOptions) {
  if (options.method !== "volumeSnapshot") return {};

  const online = options.online !== false;
  const configuration = {
    ...(options.immediateCheckpoint ? { immediateCheckpoint: true } : {}),
    ...(options.waitForArchive === false ? { waitForArchive: false } : {}),
  };

  return {
    ...(online ? {} : { online: false }),
    ...(online && Object.keys(configuration).length > 0
      ? { onlineConfiguration: configuration }
      : {}),
  };
}

/** The cluster's own method first; volume snapshots too when it declares a snapshot class. */
export function backupMethods(cluster: ClusterLike): BackupMethod[] {
  const own = backupConfig(cluster).method;
  const methods: BackupMethod[] = own ? [own] : [];

  if (cluster.spec.backup?.volumeSnapshot && own !== "volumeSnapshot")
    methods.push("volumeSnapshot");

  return methods;
}

/** What `kubectl cnpg backup` creates; undefined when the cluster has no backup method. */
export function backupNow(
  cluster: ClusterLike,
  now: number,
  options: BackupOptions = {},
): BackupManifest | undefined {
  const config = backupConfig(cluster);
  const method = options.method ?? config.method;

  if (!method || !backupMethods(cluster).includes(method)) return undefined;

  return {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Backup",
    metadata: { name: `${cluster.getName()}-${stamp(now)}`, namespace: cluster.getNs() ?? "" },
    spec: {
      cluster: { name: cluster.getName() },
      method,
      ...(method === "plugin" && config.plugin
        ? { pluginConfiguration: { name: config.plugin } }
        : {}),
      ...(options.target ? { target: options.target } : {}),
      ...snapshotSettings({ ...options, method }),
    },
  };
}

/** What the schedule would start, now: its cluster, method and plugin. */
export function backupFromSchedule(schedule: ScheduledBackupLike, now: number): BackupManifest {
  return {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Backup",
    metadata: { name: `${schedule.getName()}-${stamp(now)}`, namespace: schedule.getNs() ?? "" },
    spec: {
      cluster: { name: schedule.spec.cluster.name },
      method: schedule.spec.method ?? "barmanObjectStore",
      ...(schedule.spec.pluginConfiguration
        ? { pluginConfiguration: { name: schedule.spec.pluginConfiguration.name } }
        : {}),
    },
  };
}

export function scheduleBackupRefusal(
  schedule: ScheduledBackupLike,
  clusters: ClusterLike[],
): string | undefined {
  const cluster = clusters.find(
    (each) => each.getNs() === schedule.getNs() && each.getName() === schedule.spec.cluster.name,
  );

  if (!cluster)
    return `No cluster named ${schedule.spec.cluster.name}, so there is nothing to back up.`;
  if (isHibernated(cluster)) return `${cluster.getName()} is hibernated. Wake it first.`;

  return undefined;
}

/** Clusters a backup can be started for now. */
export function backupCandidates(clusters: ClusterLike[]): ClusterLike[] {
  return clusters.filter((cluster) => refusal(cluster, "backup") === undefined);
}

/** Deleted with the schedule: Kubernetes collects what it owns. */
export function ownedBackups(schedule: ScheduledBackupLike, backups: BackupLike[]): BackupLike[] {
  return backups.filter(
    (backup) =>
      backup.getNs() === schedule.getNs() &&
      (backup.metadata.ownerReferences ?? []).some(
        (owner) => owner.kind === "ScheduledBackup" && owner.name === schedule.getName(),
      ),
  );
}

export function annotationPatch(name: string, value: string | null) {
  return { metadata: { annotations: { [name]: value } } };
}

export function restartPatch(now: number) {
  return annotationPatch(RESTART_ANNOTATION, new Date(now).toISOString());
}

export function reloadPatch(now: number) {
  return annotationPatch(RELOAD_ANNOTATION, new Date(now).toISOString());
}

export function hibernationPatch(on: boolean) {
  return annotationPatch(HIBERNATION_ANNOTATION, on ? "on" : "off");
}

/** The status patch `kubectl cnpg promote` sends. */
export function promotePatch(target: string) {
  return {
    status: {
      targetPrimary: target,
      phase: "Switchover in progress",
      phaseReason: `Switching over to ${target}`,
    },
  };
}

/** Why a write cannot be done now, or undefined when it can. */
export function refusal(
  cluster: ClusterLike,
  action: "backup" | "restart" | "reload" | "promote" | "hibernate" | "wake",
): string | undefined {
  const hibernated = isHibernated(cluster);

  if (action === "wake") return hibernated ? undefined : `${cluster.getName()} is not hibernated.`;
  if (hibernated) return `${cluster.getName()} is hibernated. Wake it first.`;

  if (action === "backup" && !backupConfig(cluster).method) {
    return `${cluster.getName()} has no backup method configured.`;
  }

  if (action === "promote") {
    if (cluster.status?.phase !== HEALTHY_PHASE) {
      return `${cluster.getName()} is "${cluster.status?.phase ?? "unknown"}". A switchover needs a healthy cluster.`;
    }
    if (replicasOf(cluster).length === 0) return `${cluster.getName()} has no healthy replica.`;
  }

  return undefined;
}

export function suspendPatch(suspend: boolean) {
  return { spec: { suspend } };
}

export function pausePatch(paused: boolean) {
  return { spec: { pgbouncer: { paused } } };
}

/** What `kubectl cnpg psql` runs: psql as postgres over the local socket, in the postgres container. */
export function psqlCommand(cluster: ClusterLike, instance: string): string {
  return `kubectl exec -it -n ${cluster.getNs() ?? "default"} ${instance} -c postgres -- psql`;
}

export function psqlRefusal(
  cluster: ClusterLike,
  instance: string | undefined,
): string | undefined {
  if (isHibernated(cluster)) return `${cluster.getName()} is hibernated. Wake it first.`;
  if (!instance) return `${cluster.getName()} has no primary yet.`;
  if (!(cluster.status?.instancesStatus?.healthy ?? []).includes(instance)) {
    return `${instance} is not healthy, so psql may not be able to connect.`;
  }

  return undefined;
}

export function restartReplicasRefusal(cluster: ClusterLike): string | undefined {
  if (isHibernated(cluster)) return `${cluster.getName()} is hibernated. Wake it first.`;
  if (cluster.status?.phase !== HEALTHY_PHASE) {
    return `${cluster.getName()} is "${cluster.status?.phase ?? "unknown"}". Restart its replicas once it is healthy.`;
  }
  if (replicaNames(cluster).length === 0) return `${cluster.getName()} has no replica.`;

  return undefined;
}

/** Why an instance must not be touched as a replica now, read from the cluster just fetched. */
export function notAReplica(fresh: ClusterLike, instance: string): string | undefined {
  if (instance === fresh.status?.currentPrimary) return `${instance} is the primary now.`;
  if (instance === fresh.status?.targetPrimary) return `${instance} is being promoted.`;

  return undefined;
}

/** A replica restarts by having its pod deleted; it is back once a newer pod is Ready. */
export function podBackAfter(pod: PodLike | undefined, deletedAt: number): boolean {
  const created = Date.parse(pod?.metadata.creationTimestamp ?? "");

  return (
    !Number.isNaN(created) &&
    created >= deletedAt &&
    pod?.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) === true
  );
}

export const INPLACE_PRIMARY_RESTART = "Primary instance is being restarted in-place";

export type InstanceRestart =
  | { kind: "in-place"; patch: { status: { phase: string; phaseReason: string } } }
  | { kind: "delete-pod"; pod: string };

/** As `kubectl cnpg restart CLUSTER INSTANCE`: the primary restarts in place, a replica's pod is deleted. */
export function instanceRestart(cluster: ClusterLike, instance: string): InstanceRestart {
  return instance === cluster.status?.currentPrimary
    ? {
        kind: "in-place",
        patch: { status: { phase: INPLACE_PRIMARY_RESTART, phaseReason: "Requested by the user" } },
      }
    : { kind: "delete-pod", pod: instance };
}

export function instanceRefusal(
  cluster: ClusterLike,
  instance: string,
  action: "restart" | "destroy",
): string | undefined {
  if (isHibernated(cluster)) return `${cluster.getName()} is hibernated. Wake it first.`;
  if (cluster.status?.phase !== HEALTHY_PHASE) {
    return `${cluster.getName()} is "${cluster.status?.phase ?? "unknown"}". Wait until it is healthy.`;
  }
  if (action === "destroy") {
    if (instance === cluster.status?.currentPrimary) {
      return `${instance} is the primary. Switch over to another instance first.`;
    }
    if (replicaNames(cluster).length < 1 || cluster.spec.instances < 2) {
      return `${cluster.getName()} has a single instance; destroying it would leave no data.`;
    }
  }

  return undefined;
}

export interface Command {
  label: string;
  command: string;
}

export function clusterCommands(cluster: ClusterLike): Command[] {
  const name = cluster.getName();
  const ns = cluster.getNs() ?? "default";

  return [
    { label: "Status", command: `kubectl cnpg status ${name} -n ${ns}` },
    { label: "psql on the primary", command: `kubectl cnpg psql ${name} -n ${ns}` },
    {
      label: "Operator log for this cluster",
      command: `kubectl logs -n cnpg-system deploy/cnpg-controller-manager | grep '"cluster":"${name}"'`,
    },
    {
      label: "Events",
      command: `kubectl get events -n ${ns} --field-selector involvedObject.name=${name}`,
    },
  ];
}
