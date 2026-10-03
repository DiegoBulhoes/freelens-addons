export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label }: { tone?: Tone; label: string }) {
  return <span className={`Trivy-status${tone ? ` Trivy-status--${tone}` : ""}`}>{label}</span>;
}
