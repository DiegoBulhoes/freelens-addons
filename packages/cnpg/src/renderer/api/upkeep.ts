import { ago } from "./backups";
import { isHibernated, type Tone, type Verdict } from "./clusters";
import type { BackupLike, ClusterLike, EventLike } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The operator renews its own certificates a week before they expire. */
export const RENEWAL_WINDOW_MS = 7 * DAY_MS;

export interface CertificateExpiry {
  secret: string;
  expiresAt?: number;
  tone: Tone;
}

// The operator writes "2027-01-01 21:37:01 +0000 UTC", which Date.parse does not read.
export function parseOperatorTime(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(value);
  const at = match ? Date.parse(`${match[1]}T${match[2]}Z`) : Number.NaN;

  return Number.isNaN(at) ? undefined : at;
}

export function certificateExpiries(cluster: ClusterLike, now: number): CertificateExpiry[] {
  const expirations = cluster.status?.certificates?.expirations ?? {};

  return Object.entries(expirations)
    .map(([secret, value]) => {
      const expiresAt = parseOperatorTime(value);
      const left = expiresAt === undefined ? undefined : expiresAt - now;
      const tone: Tone =
        left === undefined
          ? "info"
          : left <= 0
            ? "critical"
            : left <= RENEWAL_WINDOW_MS
              ? "warning"
              : "ok";

      return { secret, expiresAt, tone };
    })
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
}

export function describeExpiry(expiry: CertificateExpiry, now: number): string {
  if (expiry.expiresAt === undefined) return "Expiry unreadable";

  const days = Math.floor((expiry.expiresAt - now) / DAY_MS);

  if (expiry.expiresAt <= now)
    return `Expired ${ago(new Date(expiry.expiresAt).toISOString(), now)}`;
  if (days < 1) return "Expires today";

  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export interface VolumeProblem {
  pvc: string;
  verdict: Verdict;
}

export function volumeProblems(cluster: ClusterLike): VolumeProblem[] {
  const status = cluster.status;
  const problems: VolumeProblem[] = [];

  for (const pvc of status?.unusablePVC ?? []) {
    problems.push({
      pvc,
      verdict: {
        tone: "critical",
        label: "Unusable volume",
        reason: `${pvc} cannot be used by an instance; the operator will not start one on it.`,
      },
    });
  }

  // Hibernation keeps the volumes on purpose, and the operator calls them dangling.
  if (!isHibernated(cluster)) {
    for (const pvc of status?.danglingPVC ?? []) {
      problems.push({
        pvc,
        verdict: {
          tone: "warning",
          label: "Dangling volume",
          reason: `${pvc} has no instance attached to it.`,
        },
      });
    }
  }

  for (const pvc of status?.initializingPVC ?? []) {
    problems.push({
      pvc,
      verdict: {
        tone: "info",
        label: "Volume initializing",
        reason: `${pvc} is still being prepared for an instance.`,
      },
    });
  }

  return problems;
}

/** What the attention list adds for a cluster beyond its state and its backups. */
export function upkeepIssues(cluster: ClusterLike, now: number): Verdict[] {
  const certificates = certificateExpiries(cluster, now)
    .filter((expiry) => expiry.tone === "critical" || expiry.tone === "warning")
    .map(
      (expiry): Verdict => ({
        tone: expiry.tone,
        label: expiry.tone === "critical" ? "Certificate expired" : "Certificate expiring",
        reason: `${expiry.secret}: ${describeExpiry(expiry, now)}.`,
      }),
    );
  const volumes = volumeProblems(cluster)
    .filter((problem) => problem.verdict.tone !== "info")
    .map((problem) => problem.verdict);

  return [...certificates, ...volumes];
}

// Instances, their PVCs and join jobs are named <cluster>-<serial>[-...].
function isInstanceObject(name: string, cluster: string): boolean {
  return name.startsWith(`${cluster}-`) && /^\d+(-|$)/.test(name.slice(cluster.length + 1));
}

/** Warnings about the cluster, its instances, volumes and backups; newest first. */
export function clusterEvents(
  events: EventLike[],
  cluster: ClusterLike,
  backups: BackupLike[],
): EventLike[] {
  const name = cluster.getName();
  const ownBackups = new Set(
    backups
      .filter((backup) => backup.getNs() === cluster.getNs() && backup.spec.cluster.name === name)
      .map((backup) => backup.getName()),
  );

  const timeOf = (event: EventLike) =>
    Date.parse(event.lastTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp ?? "") ||
    0;

  return events
    .filter((event) => event.type === "Warning" && event.getNs() === cluster.getNs())
    .filter((event) => {
      const object = event.involvedObject;

      if (object.kind === "Cluster") return object.name === name;
      if (object.kind === "Backup") return ownBackups.has(object.name);

      return (
        (object.kind === "Pod" || object.kind === "PersistentVolumeClaim") &&
        isInstanceObject(object.name, name)
      );
    })
    .sort((a, b) => timeOf(b) - timeOf(a));
}

export function eventTime(event: EventLike): string | undefined {
  return event.lastTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp;
}
