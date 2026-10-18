export type Tone = "critical" | "warning" | "info" | "ok";

export interface Verdict {
  tone: Tone;
  label: string;
  reason: string;
}

export const RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

export function worse(a: Verdict, b: Verdict): Verdict {
  return RANK[b.tone] < RANK[a.tone] ? b : a;
}

/** The state for a drawer's banner, with barman's cause when one was read. */
export function withCause(verdict: Verdict, cause?: string): Verdict {
  return cause ? { ...verdict, reason: `${verdict.reason} Cause: ${cause}` } : verdict;
}

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

/** A time still to come, as "in 3h"; one already past is "due". */
export function until(time: string | undefined, now: number): string {
  if (!time) return "—";

  const at = Date.parse(time);

  if (Number.isNaN(at)) return "—";
  if (at - now < 60_000) return "due";

  return `in ${formatAge(at - now)}`;
}
