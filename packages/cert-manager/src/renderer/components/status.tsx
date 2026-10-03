export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label }: { tone?: Tone; label: string }) {
  return (
    <span className={`CertManager-status${tone ? ` CertManager-status--${tone}` : ""}`}>
      {label}
    </span>
  );
}
