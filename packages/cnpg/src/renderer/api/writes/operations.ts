import { backupConfig } from "../backups/backups";
import {
  HEALTHY_PHASE,
  HIBERNATION_ANNOTATION,
  healthyReplicaNames,
  isHibernated,
  replicaNames,
} from "../clusters/clusters";
import type { Command } from "../shared/commands";
import { reasonOf } from "../shared/errors";
import { isReady } from "../shared/rows";
import type { ClusterLike, PodLike } from "../shared/types";

export const RESTART_ANNOTATION = "kubectl.kubernetes.io/restartedAt";
export const RELOAD_ANNOTATION = "cnpg.io/reloadedAt";

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

export function hibernatedRefusal(cluster: ClusterLike): string | undefined {
  return isHibernated(cluster) ? `${cluster.getName()} is hibernated. Wake it first.` : undefined;
}

/** Why a write cannot be done now, or undefined when it can. */
export function clusterActionRefusal(
  cluster: ClusterLike,
  action: "backup" | "restart" | "reload" | "promote" | "hibernate" | "wake",
): string | undefined {
  if (action === "wake") {
    return isHibernated(cluster) ? undefined : `${cluster.getName()} is not hibernated.`;
  }

  const hibernated = hibernatedRefusal(cluster);

  if (hibernated) return hibernated;

  if (action === "backup" && !backupConfig(cluster).method) {
    return `${cluster.getName()} has no backup method configured.`;
  }

  if (action === "promote") {
    if (cluster.status?.phase !== HEALTHY_PHASE) {
      return `${cluster.getName()} is "${cluster.status?.phase ?? "unknown"}". A switchover needs a healthy cluster.`;
    }
    if (healthyReplicaNames(cluster).length === 0)
      return `${cluster.getName()} has no healthy replica.`;
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
  const hibernated = hibernatedRefusal(cluster);

  if (hibernated) return hibernated;
  if (!instance) return `${cluster.getName()} has no primary yet.`;
  if (!(cluster.status?.instancesStatus?.healthy ?? []).includes(instance)) {
    return `${instance} is not healthy, so psql may not be able to connect.`;
  }

  return undefined;
}

export function restartReplicasRefusal(cluster: ClusterLike): string | undefined {
  const hibernated = hibernatedRefusal(cluster);

  if (hibernated) return hibernated;
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

/** A replica restarts by having its pod deleted; it is back once a pod with another uid is Ready. */
export function podReplaced(pod: PodLike | undefined, deletedUid: string | undefined): boolean {
  const uid = pod?.metadata.uid;

  return uid !== undefined && uid !== deletedUid && isReady(pod);
}

/** A Kubernetes Status of 404, as the host's API client throws it. */
export function isNotFound(error: unknown): boolean {
  return (error as { error?: { code?: unknown } } | null | undefined)?.error?.code === 404;
}

/** An object already gone is fine; any other error stops the steps after `step`. */
export function unlessNotFound(step: string): (error: unknown) => void {
  return (error) => {
    if (!isNotFound(error)) {
      throw new Error(`Could not ${step}, so nothing after it was deleted: ${reasonOf(error)}`);
    }
  };
}

/** Why the switchover confirmed earlier must not be sent to the cluster just fetched. */
export function promoteRefusal(fresh: ClusterLike, target: string): string | undefined {
  const refused = clusterActionRefusal(fresh, "promote");

  if (refused) return refused;
  if (!healthyReplicaNames(fresh).includes(target))
    return `${target} is no longer a healthy replica.`;

  return undefined;
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

/** Why the restart confirmed against `seen` no longer fits the cluster just fetched. */
export function instanceRestartRefusal(
  seen: ClusterLike,
  fresh: ClusterLike,
  instance: string,
): string | undefined {
  const refused = instanceRefusal(fresh, instance, "restart");

  if (refused) return refused;
  if (instanceRestart(seen, instance).kind !== instanceRestart(fresh, instance).kind) {
    return instance === fresh.status?.currentPrimary
      ? `${instance} became the primary.`
      : `${instance} is no longer the primary.`;
  }

  return undefined;
}

export function instanceRefusal(
  cluster: ClusterLike,
  instance: string,
  action: "restart" | "destroy",
): string | undefined {
  const hibernated = hibernatedRefusal(cluster);

  if (hibernated) return hibernated;
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

/** On the operator's Deployment and pods, whether installed from the release manifest or the Helm chart. */
const OPERATOR_SELECTOR = "app.kubernetes.io/name=cloudnative-pg";
// Found by label at paste time: neither the namespace nor the Deployment's name is fixed.
const OPERATOR_NAMESPACE = `kubectl get deploy -A -l ${OPERATOR_SELECTOR} -o jsonpath='{.items[0].metadata.namespace}'`;

export function clusterCommands(cluster: ClusterLike): Command[] {
  const name = cluster.getName();
  const ns = cluster.getNs() ?? "default";

  return [
    { label: "Status", command: `kubectl cnpg status ${name} -n ${ns}` },
    { label: "psql on the primary", command: `kubectl cnpg psql ${name} -n ${ns}` },
    {
      label: "Operator log for this cluster",
      command: `kubectl logs -n "$(${OPERATOR_NAMESPACE})" -l ${OPERATOR_SELECTOR} --tail=-1 | grep '"cluster":"${name}"'`,
    },
    {
      label: "Events",
      command: `kubectl get events -n ${ns} --field-selector involvedObject.name=${name}`,
    },
  ];
}
