/**
 * Which cluster this frame is showing, and what its state file is called.
 *
 * `clusterIdFromHost` is a port of the host's own `getClusterIdFromHost`
 * (`src/common/utils/cluster-id-url-parsing.ts` in @freelensapp/core 1.10.3),
 * which `hosted-cluster-id.injectable.ts` calls with `location.host`. The
 * extension API does not re-export it: `Common.Util` carries no cluster helper
 * at all.
 *
 * The host is a parameter rather than a read of `location`, for the same reason
 * `getPressure` takes `now`.
 */

/**
 * Kept deliberately faithful to upstream, including the unanchored suffix test:
 * an unrecognised host yields its trailing label rather than `undefined`, so
 * `renderer.freelens.app.evil.example:443` parses as `example`. That is why
 * `stateFileName` validates instead of trusting the result.
 */
export function clusterIdFromHost(host: string): string | undefined {
  const labels = (host.split(":")[0] ?? "").split(".");

  if (labels[labels.length - 1] === "localhost") {
    labels.pop();
  } else if (labels.length >= 3 && labels.slice(-3).join(".") === "renderer.freelens.app") {
    labels.splice(-3);
  }

  return labels[labels.length - 1];
}

/** One safe path segment. Freelens' own ids are md5 hex; the check is looser than that on purpose. */
const SAFE_CLUSTER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `undefined` means "do not persist" — the root frame, where there is no cluster
 * and this extension has no UI, and any host shape this cannot read.
 *
 * Not upstream's `${clusterId || "app"}.json` fallback: a file every cluster
 * shared would pin one Application everywhere.
 */
export function stateFileName(clusterId: string | undefined): string | undefined {
  return clusterId !== undefined && SAFE_CLUSTER_ID.test(clusterId)
    ? `${clusterId}.json`
    : undefined;
}
