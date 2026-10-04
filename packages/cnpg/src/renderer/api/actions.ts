import { Renderer } from "@freelensapp/extensions";

import { causeFromLog, logSourceFor } from "./causes";
import { Backup, Cluster, Pooler, Publication, ScheduledBackup, Subscription } from "./kinds";
import {
  type BackupManifest,
  instanceRefusal,
  instanceRestart,
  notAReplica,
  podBackAfter,
} from "./operations";
import { metricsPath } from "./summary";
import type {
  BackupLike,
  ClusterLike,
  InstanceStatus,
  PodLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SubscriptionLike,
} from "./types";

interface StatusCapable {
  request: {
    patch(
      url: string,
      body: { data: unknown },
      init: { headers: Record<string, string> },
    ): Promise<unknown>;
  };
  formatUrlForNotListing(desc: { name: string; namespace?: string }): string;
}

function descriptorOf(cluster: ClusterLike) {
  return { name: cluster.getName(), namespace: cluster.getNs() };
}

// The page's copy can lag a switchover; a write aimed at "a replica" must not reach the primary.
async function freshCluster(cluster: ClusterLike): Promise<ClusterLike> {
  const fresh = await Cluster.getApi().get(descriptorOf(cluster));

  if (!fresh) throw new Error(`${cluster.getName()} could not be read again before writing`);

  return fresh as unknown as ClusterLike;
}

export async function patchCluster(cluster: ClusterLike, patch: object): Promise<void> {
  await Cluster.getApi().patch(descriptorOf(cluster), patch as never, "merge");
}

// KubeApi has no status subresource call; this is its own request, pointed at /status.
export async function patchClusterStatus(cluster: ClusterLike, patch: object): Promise<void> {
  const api = Cluster.getApi() as unknown as StatusCapable;
  const url = `${api.formatUrlForNotListing(descriptorOf(cluster) as { name: string })}/status`;

  await api.request.patch(
    url,
    { data: patch },
    { headers: { "content-type": "application/merge-patch+json" } },
  );
}

export async function createBackup(manifest: BackupManifest): Promise<void> {
  await Backup.getApi().create(
    { name: manifest.metadata.name, namespace: manifest.metadata.namespace },
    manifest as never,
  );
}

export async function patchSchedule(schedule: ScheduledBackupLike, patch: object): Promise<void> {
  await ScheduledBackup.getApi().patch(
    { name: schedule.getName(), namespace: schedule.getNs() },
    patch as never,
    "merge",
  );
}

export async function patchPooler(pooler: PoolerLike, patch: object): Promise<void> {
  await Pooler.getApi().patch(
    { name: pooler.getName(), namespace: pooler.getNs() },
    patch as never,
    "merge",
  );
}

export async function openInstanceLog(cluster: ClusterLike, instance: string): Promise<boolean> {
  const pod = await Renderer.K8sApi.podsApi.get({ name: instance, namespace: cluster.getNs() });
  const container = pod?.getContainers().find((each) => each.name === "postgres");

  if (!pod || !container) return false;

  Renderer.Component.logTabStore.createPodTab({ selectedPod: pod, selectedContainer: container });

  return true;
}

export async function openTerminal(title: string, command: string): Promise<void> {
  const tab = Renderer.Component.createTerminalTab({ title });

  await Renderer.Component.terminalStore.sendCommand(command, { enter: true, tabId: tab.id });
}

const POLL_MS = 3000;
const REPLICA_TIMEOUT_MS = 10 * 60 * 1000;

/** One at a time, so the cluster never loses more than one replica's reads. */
export async function restartReplicas(
  cluster: ClusterLike,
  replicas: string[],
  onRestarted: (replica: string) => void,
): Promise<void> {
  const namespace = cluster.getNs();

  for (const replica of replicas) {
    const skip = notAReplica(await freshCluster(cluster), replica);

    if (skip) throw new Error(`Stopped before ${replica}: ${skip} The rest were left as they were`);

    const deletedAt = Date.now();

    await Renderer.K8sApi.podsApi.delete({ name: replica, namespace });

    for (;;) {
      if (Date.now() - deletedAt > REPLICA_TIMEOUT_MS) {
        throw new Error(
          `${replica} was not Ready again within 10 minutes; the rest were left as they were`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_MS));

      const pod = await Renderer.K8sApi.podsApi.get({ name: replica, namespace }).catch(() => null);

      if (podBackAfter((pod ?? undefined) as PodLike | undefined, deletedAt)) break;
    }

    onRestarted(replica);
  }
}

export async function deleteBackup(backup: BackupLike): Promise<void> {
  await Backup.getApi().delete({ name: backup.getName(), namespace: backup.getNs() });
}

export async function deleteSchedule(schedule: ScheduledBackupLike): Promise<void> {
  await ScheduledBackup.getApi().delete({ name: schedule.getName(), namespace: schedule.getNs() });
}

export async function deletePooler(pooler: PoolerLike): Promise<void> {
  await Pooler.getApi().delete({ name: pooler.getName(), namespace: pooler.getNs() });
}

export async function readCause(cluster: ClusterLike): Promise<string | undefined> {
  const source = logSourceFor(cluster);

  if (!source) return undefined;

  const log = await Renderer.K8sApi.podsApi.getLogs(
    { name: source.pod, namespace: cluster.getNs() },
    { container: source.container, tailLines: 300 },
  );

  return causeFromLog(log);
}

export async function readInstanceStatus(
  namespace: string | undefined,
  pod: string,
): Promise<InstanceStatus | undefined> {
  const { request } = Renderer.K8sApi.podsApi as unknown as {
    request: { get(url: string): Promise<unknown> };
  };

  // The instance manager's own endpoint, through the API server, as `kubectl cnpg status` reads it.
  return (await request.get(
    `/api/v1/namespaces/${namespace}/pods/https:${pod}:8000/proxy/pg/status`,
  )) as InstanceStatus;
}

export async function readInstanceLogs(cluster: ClusterLike, tailLines: number): Promise<string[]> {
  return Promise.all(
    (cluster.status?.instanceNames ?? []).map((pod) =>
      Renderer.K8sApi.podsApi
        .getLogs({ name: pod, namespace: cluster.getNs() }, { container: "postgres", tailLines })
        .catch(() => ""),
    ),
  );
}

export async function restartInstance(cluster: ClusterLike, instance: string): Promise<void> {
  const plan = instanceRestart(await freshCluster(cluster), instance);

  if (plan.kind === "in-place") await patchClusterStatus(cluster, plan.patch);
  else await Renderer.K8sApi.podsApi.delete({ name: plan.pod, namespace: cluster.getNs() });
}

/** As `kubectl cnpg destroy`: the pod, its jobs, then its volumes; the operator makes a new instance. */
export async function destroyInstance(cluster: ClusterLike, instance: string): Promise<void> {
  const refused = instanceRefusal(await freshCluster(cluster), instance, "destroy");

  if (refused) throw new Error(refused);

  const namespace = cluster.getNs();
  const selector = { labelSelector: `cnpg.io/instanceName=${instance}` };

  await Renderer.K8sApi.podsApi.delete({ name: instance, namespace }).catch(() => undefined);

  for (const job of (await Renderer.K8sApi.jobApi.list({ namespace }, selector)) ?? []) {
    await Renderer.K8sApi.jobApi.delete({
      name: job.getName(),
      namespace,
      propagationPolicy: "Background",
    });
  }

  for (const pvc of (await Renderer.K8sApi.pvcApi.list({ namespace }, selector)) ?? []) {
    await Renderer.K8sApi.pvcApi.delete({ name: pvc.getName(), namespace });
  }
}

export async function deleteLogical(
  object: PublicationLike | SubscriptionLike,
  kind: "Publication" | "Subscription",
) {
  const api = kind === "Publication" ? Publication.getApi() : Subscription.getApi();

  await api.delete({ name: object.getName(), namespace: object.getNs() });
}

export async function readMetrics(cluster: ClusterLike, pod: string): Promise<string> {
  const { request } = Renderer.K8sApi.podsApi as unknown as {
    request: { get(url: string): Promise<unknown> };
  };
  // Prometheus text, not JSON: the client hands it back as a string, as it does for logs.
  const text = await request.get(metricsPath(cluster, pod));

  return typeof text === "string" ? text : "";
}
