export type Tone = "critical" | "warning" | "info" | "ok";

export interface Verdict {
  tone: Tone;
  label: string;
  reason: string;
}

export const RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

/** Worst tone first, then by namespace and name; the rows' own order breaks no tie. */
export function worstFirst<Row extends { verdict: Verdict; namespace: string; name: string }>(
  rows: Row[],
): Row[] {
  return [...rows].sort(
    (a, b) =>
      RANK[a.verdict.tone] - RANK[b.verdict.tone] ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name),
  );
}

/** In rank order: the first that holds names the row. */
export const MONITOR_STATES = [
  "rejected",
  "not-selected",
  "namespace-excluded",
  "no-target",
  "port-missing",
  "no-endpoints",
  "down",
  "not-loaded",
  "healthy",
  "unknown",
] as const;

export type MonitorState = (typeof MONITOR_STATES)[number];

export const MONITOR_LOOK: Record<MonitorState, { tone: Tone; label: string }> = {
  rejected: { tone: "critical", label: "Rejected" },
  "not-selected": { tone: "warning", label: "Not selected" },
  "namespace-excluded": { tone: "warning", label: "Namespace excluded" },
  "no-target": { tone: "critical", label: "No target" },
  "port-missing": { tone: "critical", label: "Port missing" },
  "no-endpoints": { tone: "warning", label: "No endpoints" },
  down: { tone: "critical", label: "Down" },
  "not-loaded": { tone: "warning", label: "Not loaded" },
  healthy: { tone: "ok", label: "Healthy" },
  unknown: { tone: "info", label: "Unknown" },
};

export const RULE_STATES = [
  "rejected",
  "not-selected",
  "namespace-excluded",
  "not-loaded",
  "unhealthy",
  "firing",
  "pending",
  "healthy",
  "unknown",
] as const;

export type RuleState = (typeof RULE_STATES)[number];

export const RULE_LOOK: Record<RuleState, { tone: Tone; label: string }> = {
  rejected: { tone: "critical", label: "Rejected" },
  "not-selected": { tone: "warning", label: "Not selected" },
  "namespace-excluded": { tone: "warning", label: "Namespace excluded" },
  "not-loaded": { tone: "warning", label: "Not loaded" },
  unhealthy: { tone: "critical", label: "Evaluation failing" },
  firing: { tone: "warning", label: "Firing" },
  pending: { tone: "info", label: "Pending" },
  healthy: { tone: "ok", label: "Loaded" },
  unknown: { tone: "info", label: "Unknown" },
};

export function formatAge(ms: number): string {
  if (ms < 60_000) return "just now";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

export function ago(time: string | undefined, now: number): string {
  if (!time) return "—";

  const at = Date.parse(time);

  if (Number.isNaN(at)) return "—";

  const age = formatAge(Math.max(0, now - at));

  return age === "just now" ? age : `${age} ago`;
}

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
