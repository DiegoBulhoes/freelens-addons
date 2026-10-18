export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span
      className={`OpenTelemetry-status${tone ? ` OpenTelemetry-status--${tone}` : ""}`}
      title={title}
    >
      {label}
    </span>
  );
}
