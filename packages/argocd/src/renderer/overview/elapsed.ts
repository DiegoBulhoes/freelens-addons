export function since(timestamp: string | undefined): string {
  if (!timestamp) return "";

  const elapsed = Date.now() - Date.parse(timestamp);

  if (Number.isNaN(elapsed)) return "";

  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}
