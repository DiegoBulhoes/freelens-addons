export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span className={`CNPG-status${tone ? ` CNPG-status--${tone}` : ""}`} title={title}>
      {label}
    </span>
  );
}
