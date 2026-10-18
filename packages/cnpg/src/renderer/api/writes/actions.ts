import { Renderer } from "@freelensapp/extensions";

import type { BackupManifest } from "../backups/backup-manifests";
import { causeFromLog, type LogSource } from "../backups/causes";
import { metricsPath } from "../clusters/metrics";
import {
  METADATA_ONLY,
  type PartialObjectMetadataList,
  type SecretListing,
  settledListings,
} from "../clusters/secret-metadata";
import { WARNING_SELECTOR } from "../clusters/upkeep";
import {
  Backup,
  Cluster,
  Pooler,
  Publication,
  ScheduledBackup,
  Subscription,
} from "../shared/kinds";
import { type LogsRead, settleLogs } from "../shared/logs";
import { withTimeout } from "../shared/read-timeout";
import type {
  BackupLike,
  ClusterLike,
  EventLike,
  InstanceStatus,
  PodLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SubscriptionLike,
} from "../shared/types";
import {
  instanceRefusal,
  instanceRestart,
  instanceRestartRefusal,
  notAReplica,
  podReplaced,
  promotePatch,
  promoteRefusal,
  unlessNotFound,
} from "./operations";

async function okJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  return (await response.json()) as T;
}

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

function descriptorOf(object: { getName(): string; getNs(): string | undefined }) {
  return { name: object.getName(), namespace: object.getNs() };
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
  await ScheduledBackup.getApi().patch(descriptorOf(schedule), patch as never, "merge");
}

export async function patchPooler(pooler: PoolerLike, patch: object): Promise<void> {
  await Pooler.getApi().patch(descriptorOf(pooler), patch as never, "merge");
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

async function untilReplaced(
  replica: string,
  namespace: string | undefined,
  deletedUid: string | undefined,
  deletedAt: number,
): Promise<void> {
  for (;;) {
    if (Date.now() - deletedAt > REPLICA_TIMEOUT_MS) {
      throw new Error(
        `${replica} was not Ready again within 10 minutes; the rest were left as they were`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    const pod = await Renderer.K8sApi.podsApi.get({ name: replica, namespace }).catch(() => null);

    if (podReplaced((pod ?? undefined) as PodLike | undefined, deletedUid)) return;
  }
}

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

    const before = await Renderer.K8sApi.podsApi.get({ name: replica, namespace });
    const deletedUid = (before as PodLike | null)?.metadata.uid;

    const deletedAt = Date.now();

    await Renderer.K8sApi.podsApi.delete({ name: replica, namespace });
    await untilReplaced(replica, namespace, deletedUid, deletedAt);

    onRestarted(replica);
  }
}

export async function deleteBackup(backup: BackupLike): Promise<void> {
  await Backup.getApi().delete(descriptorOf(backup));
}

export async function deleteSchedule(schedule: ScheduledBackupLike): Promise<void> {
  await ScheduledBackup.getApi().delete(descriptorOf(schedule));
}

export async function deletePooler(pooler: PoolerLike): Promise<void> {
  await Pooler.getApi().delete(descriptorOf(pooler));
}

export async function readCause(
  namespace: string | undefined,
  source: LogSource,
): Promise<string | undefined> {
  const log = await withTimeout(() =>
    Renderer.K8sApi.podsApi.getLogs(
      { name: source.pod, namespace },
      { container: source.container, tailLines: 300 },
    ),
  );

  return causeFromLog(log);
}

function podsRequest() {
  return (
    Renderer.K8sApi.podsApi as unknown as {
      request: { get(url: string, query?: undefined, init?: RequestInit): Promise<unknown> };
    }
  ).request;
}

export async function readInstanceStatus(
  namespace: string | undefined,
  pod: string,
): Promise<InstanceStatus | undefined> {
  const request = podsRequest();

  // The instance manager's own endpoint, through the API server, as `kubectl cnpg status` reads it.
  return (await withTimeout((signal) =>
    request.get(
      `/api/v1/namespaces/${namespace}/pods/https:${pod}:8000/proxy/pg/status`,
      undefined,
      { signal },
    ),
  )) as InstanceStatus;
}

export async function readInstanceLogs(cluster: ClusterLike, tailLines: number): Promise<LogsRead> {
  const pods = cluster.status?.instanceNames ?? [];
  const results = await Promise.allSettled(
    pods.map((pod) =>
      withTimeout(() =>
        Renderer.K8sApi.podsApi.getLogs(
          { name: pod, namespace: cluster.getNs() },
          { container: "postgres", tailLines },
        ),
      ),
    ),
  );

  return settleLogs(pods, results);
}

export async function promote(cluster: ClusterLike, target: string): Promise<void> {
  const refused = promoteRefusal(await freshCluster(cluster), target);

  if (refused) throw new Error(refused);

  await patchClusterStatus(cluster, promotePatch(target));
}

export async function restartInstance(cluster: ClusterLike, instance: string): Promise<void> {
  const fresh = await freshCluster(cluster);
  const refused = instanceRestartRefusal(cluster, fresh, instance);

  if (refused) throw new Error(refused);

  const plan = instanceRestart(fresh, instance);

  if (plan.kind === "in-place") await patchClusterStatus(cluster, plan.patch);
  else await Renderer.K8sApi.podsApi.delete({ name: plan.pod, namespace: cluster.getNs() });
}

/** As `kubectl cnpg destroy`: the pod, its jobs, then its volumes; the operator makes a new instance. */
export async function destroyInstance(cluster: ClusterLike, instance: string): Promise<void> {
  const refused = instanceRefusal(await freshCluster(cluster), instance, "destroy");

  if (refused) throw new Error(refused);

  const namespace = cluster.getNs();
  const selector = { labelSelector: `cnpg.io/instanceName=${instance}` };

  await Renderer.K8sApi.podsApi
    .delete({ name: instance, namespace })
    .catch(unlessNotFound(`delete the pod ${instance}`));

  for (const job of (await Renderer.K8sApi.jobApi.list({ namespace }, selector)) ?? []) {
    await Renderer.K8sApi.jobApi
      .delete({ name: job.getName(), namespace, propagationPolicy: "Background" })
      .catch(unlessNotFound(`delete the job ${job.getName()}`));
  }

  for (const pvc of (await Renderer.K8sApi.pvcApi.list({ namespace }, selector)) ?? []) {
    await Renderer.K8sApi.pvcApi
      .delete({ name: pvc.getName(), namespace })
      .catch(unlessNotFound(`delete the volume ${pvc.getName()}`));
  }
}

export async function deleteLogical(
  object: PublicationLike | SubscriptionLike,
  kind: "Publication" | "Subscription",
) {
  const api = kind === "Publication" ? Publication.getApi() : Subscription.getApi();

  await api.delete(descriptorOf(object));
}

export async function readMetrics(cluster: ClusterLike, pod: string): Promise<string> {
  const request = podsRequest();
  // Prometheus text, not JSON: the client hands it back as a string, as it does for logs.
  const text = await withTimeout((signal) =>
    request.get(metricsPath(cluster, pod), undefined, { signal }),
  );

  return typeof text === "string" ? text : "";
}

/** Metadata only, each namespace on its own: no Secret value reaches the renderer. */
export async function listSecretNames(namespaces: string[]): Promise<Map<string, SecretListing>> {
  const results = await Promise.allSettled(
    namespaces.map(async (namespace) => {
      const response = await withTimeout((signal) =>
        fetch(`/api-kube/api/v1/namespaces/${namespace}/secrets`, {
          headers: { Accept: METADATA_ONLY },
          signal,
        }),
      );

      return okJson<PartialObjectMetadataList>(response);
    }),
  );

  return settledListings(namespaces, results);
}

export async function listWarningEvents(namespace: string): Promise<EventLike[]> {
  const events = await withTimeout((signal) =>
    Renderer.K8sApi.eventApi.list(
      { namespace, reqInit: { signal } },
      { fieldSelector: WARNING_SELECTOR },
    ),
  );

  return (events ?? []) as unknown as EventLike[];
}

export function openHostList(path: string): void {
  Renderer.Navigation.navigate(path);
}
