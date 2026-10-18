// Facts are absolute, tables relative (design standard).
export function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return "—";

  const at = Date.parse(timestamp);

  return Number.isNaN(at) ? timestamp : new Date(at).toLocaleString();
}

export function describeAge(timestamp: string | undefined, now: number): string | undefined {
  if (!timestamp) return undefined;

  const at = Date.parse(timestamp);

  if (Number.isNaN(at)) return undefined;

  return `${describeDuration(now - at)} ago`;
}

export function describeDuration(milliseconds: number): string {
  // Checked before rounding: 30 seconds would round up to "1 minute".
  if (milliseconds < 60_000) return "less than a minute";

  const minutes = Math.round(milliseconds / 60_000);

  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);

  return `${days} day${days === 1 ? "" : "s"}`;
}
