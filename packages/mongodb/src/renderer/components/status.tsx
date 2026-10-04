export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span className={`MongoDB-status${tone ? ` MongoDB-status--${tone}` : ""}`} title={title}>
      {label}
    </span>
  );
}
