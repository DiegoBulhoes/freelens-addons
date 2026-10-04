export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span className={`__Name__-status${tone ? ` __Name__-status--${tone}` : ""}`} title={title}>
      {label}
    </span>
  );
}
