import type { Ingress, Pod } from "@freelensapp/kube-object";

import { Application } from "./application";

// Configurable as `application.instanceLabelKey`; a cluster that changed it is why
// selectApplicationPods also falls back to matching pod names.
export const INSTANCE_LABEL = "app.kubernetes.io/instance";

const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"]);

const MAX_NAMESPACES_IN_SENTENCE = 3;

export function namespacesOf(application: Application): string[] {
  const namespaces = new Set<string>();

  for (const resource of Application.getManagedResources(application)) {
    if (resource.namespace) namespaces.add(resource.namespace);
  }

  const destination = application.spec.destination.namespace;
  if (destination) namespaces.add(destination);

  return [...namespaces];
}

export function selectApplicationPods(pods: Pod[], application: Application): Pod[] {
  const namespaces = namespacesOf(application);

  if (namespaces.length === 0) return [];

  const name = application.getName();
  const workloadNames = Application.getManagedResources(application)
    .filter((resource) => resource.kind && WORKLOAD_KINDS.has(resource.kind) && resource.name)
    .map((resource) => resource.name as string);

  return pods.filter((pod) => {
    if (!namespaces.includes(pod.getNs() ?? "")) return false;

    if (pod.getLabels().includes(`${INSTANCE_LABEL}=${name}`)) return true;

    return workloadNames.some((workload) => pod.getName().startsWith(`${workload}-`));
  });
}

export function findArgoCDUrlIn(ingresses: Ingress[], namespace: string): string | undefined {
  for (const ingress of ingresses) {
    if (ingress.getNs() !== namespace) continue;

    for (const rule of ingress.spec?.rules ?? []) {
      // The backend is a union: networking.k8s.io/v1 names a service object, the older shape names
      // it as a string, so both are read structurally.
      const servesArgo = (rule.http?.paths ?? []).some((path) => {
        const backend = path.backend as { service?: { name?: string }; serviceName?: string };
        const name = backend?.service?.name ?? backend?.serviceName;

        return name?.includes("argocd-server") ?? false;
      });

      if (servesArgo && rule.host) return `https://${rule.host}`;
    }
  }

  return undefined;
}

/** What one pod listing asked for, and how much of it was refused. */
export interface PodListing {
  requestedNamespaces: string[];
  /** Which namespaces refused is not knowable: the host's onLoadFailure carries no namespace. */
  unreadableCount: number;
}

function nameNamespaces(namespaces: string[]): string {
  if (namespaces.length === 1) return `namespace ${namespaces[0]}`;
  if (namespaces.length > MAX_NAMESPACES_IN_SENTENCE) return `all ${namespaces.length} namespaces`;

  return `namespaces ${namespaces.join(", ")}`;
}

export function describeMissingPods(applicationName: string, listing: PodListing): string {
  const { requestedNamespaces, unreadableCount } = listing;

  if (unreadableCount === 0) return `${applicationName} has no running pods to read logs from.`;

  const unknown = `It is not known whether ${applicationName} has any.`;

  if (unreadableCount === requestedNamespaces.length) {
    return `Could not list pods in ${nameNamespaces(requestedNamespaces)}. ${unknown}`;
  }

  // "some" rather than the count: one refusal can stand for the whole request, so a number here
  // would be a second unverified claim in a sentence that exists to avoid the first.
  return `Could not list pods in some of the ${requestedNamespaces.length} namespaces ${applicationName} deploys to. ${unknown}`;
}
