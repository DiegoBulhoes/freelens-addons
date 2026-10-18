import type { ApplicationDestination } from "../shared/types";

const IN_CLUSTER_SERVER_URL = "https://kubernetes.default.svc";

export function shortenClusterUrl(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) return undefined;
  if (serverUrl === IN_CLUSTER_SERVER_URL) return "in-cluster";

  return serverUrl.replace(/^https?:\/\//, "");
}

export function formatDestination(destination?: ApplicationDestination): string {
  const cluster = destination?.name ?? shortenClusterUrl(destination?.server);
  const namespace = destination?.namespace;

  if (cluster && namespace) return `${cluster}/${namespace}`;

  return cluster ?? namespace ?? "—";
}
