import { formatAge } from "./backups";
import type { ClusterLike } from "./types";

export interface Metrics {
  /** When Postgres started, in ms; a restart in place resets it, unlike the pod's age. */
  startedAt?: number;
  databases: { name: string; bytes: number }[];
}

// Prometheus text: `name{label="value"} 1.23e+06`, one sample per line.
export function parseMetrics(text: string): Metrics {
  const metrics: Metrics = { databases: [] };

  for (const line of text.split("\n")) {
    const match = /^(\w+)(?:\{([^}]*)\})?\s+(\S+)/.exec(line);

    if (!match) continue;

    const [, name, labels = "", raw = ""] = match;
    const value = Number(raw);

    if (Number.isNaN(value)) continue;

    if (name === "cnpg_pg_postmaster_start_time") metrics.startedAt = value * 1000;

    if (name === "cnpg_pg_database_size_bytes") {
      const database = /datname="([^"]*)"/.exec(labels)?.[1];

      // Templates are copies to create from, not data anyone keeps.
      if (database && !database.startsWith("template"))
        metrics.databases.push({ name: database, bytes: value });
    }
  }

  metrics.databases.sort((a, b) => b.bytes - a.bytes);

  return metrics;
}

export function totalBytes(metrics: Metrics): number {
  return metrics.databases.reduce((sum, database) => sum + database.bytes, 0);
}

export function describeUptime(metrics: Metrics, now: number): string | undefined {
  return metrics.startedAt === undefined
    ? undefined
    : formatAge(Math.max(0, now - metrics.startedAt));
}

/** The exporter answers in plain HTTP unless the cluster turned TLS on for it. */
export function metricsPath(cluster: ClusterLike, pod: string): string {
  const scheme = cluster.spec.monitoring?.tls?.enabled ? "https:" : "";

  return `/api/v1/namespaces/${cluster.getNs()}/pods/${scheme}${pod}:9187/proxy/metrics`;
}
