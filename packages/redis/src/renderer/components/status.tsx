export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span className={`Redis-status${tone ? ` Redis-status--${tone}` : ""}`} title={title}>
      {label}
    </span>
  );
}
