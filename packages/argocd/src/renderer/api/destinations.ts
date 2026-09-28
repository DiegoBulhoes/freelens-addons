const IN_CLUSTER_SERVER_URL = "https://kubernetes.default.svc";

export function shortenClusterUrl(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) return undefined;
  if (serverUrl === IN_CLUSTER_SERVER_URL) return "in-cluster";

  return serverUrl.replace(/^https?:\/\//, "");
}
