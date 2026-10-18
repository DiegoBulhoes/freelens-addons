export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span className={`Prometheus-status${tone ? ` Prometheus-status--${tone}` : ""}`} title={title}>
      {label}
    </span>
  );
}
