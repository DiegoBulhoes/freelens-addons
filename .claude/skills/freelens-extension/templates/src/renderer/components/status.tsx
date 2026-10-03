export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label }: { tone?: Tone; label: string }) {
  return (
    <span className={`__Name__-status${tone ? ` __Name__-status--${tone}` : ""}`}>{label}</span>
  );
}
