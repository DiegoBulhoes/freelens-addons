import { backupConfig } from "./backups";
import type { ClusterLike } from "./types";

export const PLUGIN_CONTAINER = "plugin-barman-cloud";

/** Where barman writes: the plugin's sidecar, or postgres itself for the in-tree method. */
export function logSourceFor(cluster: ClusterLike): { pod: string; container: string } | undefined {
  const config = backupConfig(cluster);
  const pod = cluster.status?.currentPrimary;

  if (!pod || !config.archivesWal) return undefined;

  return { pod, container: config.method === "plugin" ? PLUGIN_CONTAINER : "postgres" };
}

/** Only these send us to the log: the others say why already. */
export function wantsCause(label: string): boolean {
  return (
    label === "Archiving failing" || label === "Last backup failed" || label === "Last run failed"
  );
}

// The operator only records "exit status 1"; barman's own stderr line says why.
export function causeFromLog(log: string): string | undefined {
  let cause: string | undefined;

  for (const line of log.split("\n")) {
    let message: unknown;

    try {
      message = (JSON.parse(line) as { msg?: unknown }).msg;
    } catch {
      continue;
    }

    if (typeof message !== "string") continue;

    const at = message.indexOf("ERROR:");

    if (at >= 0) cause = message.slice(at + "ERROR:".length).trim();
  }

  return cause;
}
