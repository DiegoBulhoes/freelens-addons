import { Renderer } from "@freelensapp/extensions";

import { crashLogIsPrevious } from "../collectors/causes";
import type { CoverageRow } from "../coverage/coverage";
import { OPERATOR_SELECTOR, type OperatorDeployment } from "../coverage/operator";
import {
  type Listing,
  METADATA_ONLY,
  type PartialObjectMetadataList,
  settledListings,
} from "../coverage/reference-names";
import { COLLECTOR_CONTAINER } from "../coverage/workload-pods";
import { withTimeout } from "../shared/read-timeout";
import type { PodLike } from "../shared/types";

async function okJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  return (await response.json()) as T;
}

export const API_PROXY = "/api-kube";

/** The host's own restart: it sets the template's restartedAt, as `kubectl rollout restart` does. */
export async function restartWorkload(row: CoverageRow): Promise<void> {
  const target = { name: row.name, namespace: row.namespace };

  if (row.kind === "CronJob" || row.kind === "Job") throw new Error(`A ${row.kind} has no restart`);
  if (row.kind === "StatefulSet") await Renderer.K8sApi.statefulSetApi.restart(target);
  else if (row.kind === "DaemonSet") await Renderer.K8sApi.daemonSetApi.restart(target);
  else await Renderer.K8sApi.deploymentApi.restart(target);
}

export function readPreviousLog(pod: PodLike): Promise<string> {
  return withTimeout(() =>
    Renderer.K8sApi.podsApi.getLogs(
      { name: pod.getName(), namespace: pod.getNs() },
      { container: COLLECTOR_CONTAINER, previous: crashLogIsPrevious(pod), tailLines: 60 },
    ),
  );
}

async function listNames(
  resource: "secrets" | "configmaps",
  namespaces: string[],
): Promise<Map<string, Listing>> {
  const results = await Promise.allSettled(
    namespaces.map(async (namespace) => {
      const response = await withTimeout((signal) =>
        fetch(`${API_PROXY}/api/v1/namespaces/${namespace}/${resource}`, {
          headers: { Accept: METADATA_ONLY },
          signal,
        }),
      );

      return okJson<PartialObjectMetadataList>(response);
    }),
  );

  return settledListings(namespaces, results);
}

/** `namespace/name` of the Secrets in each namespace, as metadata only: no Secret value reaches the renderer. */
export function listSecretNames(namespaces: string[]): Promise<Map<string, Listing>> {
  return listNames("secrets", namespaces);
}

/** Metadata only, so a namespace's ConfigMap data is not loaded for one name. */
export function listConfigMapNames(namespaces: string[]): Promise<Map<string, Listing>> {
  return listNames("configmaps", namespaces);
}

/** The one cluster-wide read the language switches need; scoped stores may not hold its namespace. */
export async function listOperatorDeployments(): Promise<OperatorDeployment[]> {
  const response = await withTimeout((signal) =>
    fetch(
      `${API_PROXY}/apis/apps/v1/deployments?labelSelector=${encodeURIComponent(OPERATOR_SELECTOR)}`,
      { signal },
    ),
  );

  return (await okJson<{ items?: OperatorDeployment[] }>(response)).items ?? [];
}

export function openHostList(path: string): void {
  Renderer.Navigation.navigate(path);
}

export async function openPodLog(pod: PodLike, container: string): Promise<boolean> {
  const found = await Renderer.K8sApi.podsApi.get({ name: pod.getName(), namespace: pod.getNs() });
  const selected = found
    ?.getAllContainers()
    .find((each: { name: string }) => each.name === container);

  if (!found || !selected) return false;

  Renderer.Component.logTabStore.createPodTab({ selectedPod: found, selectedContainer: selected });

  return true;
}
