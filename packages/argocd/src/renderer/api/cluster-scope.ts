// Port of the host's `getClusterIdFromHost` (@freelensapp/core 1.10.3), which the extension API does not export.

/** Faithful to upstream: an unrecognised host yields its trailing label, so `stateFileName` validates. */
export function clusterIdFromHost(host: string): string | undefined {
  const labels = (host.split(":")[0] ?? "").split(".");

  if (labels[labels.length - 1] === "localhost") {
    labels.pop();
  } else if (labels.length >= 3 && labels.slice(-3).join(".") === "renderer.freelens.app") {
    labels.splice(-3);
  }

  return labels[labels.length - 1];
}

const SAFE_CLUSTER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `undefined` means do not persist. No shared fallback file: it would pin one Application everywhere. */
export function stateFileName(clusterId: string | undefined): string | undefined {
  return clusterId !== undefined && SAFE_CLUSTER_ID.test(clusterId)
    ? `${clusterId}.json`
    : undefined;
}
