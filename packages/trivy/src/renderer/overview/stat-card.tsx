export type Tone = "critical" | "warning" | "info" | "ok";

/**
 * One number and what it counts. A count of problems is only alarming when
 * there is one, so the tone applies above zero.
 */
export function StatCard({ value, label, tone }: { value: number; label: string; tone?: Tone }) {
  return (
    <div className={`Trivy-card${tone && value > 0 ? ` Trivy-card--${tone}` : ""}`}>
      <span className="Trivy-card__value">{value}</span>
      <span className="Trivy-card__label">{label}</span>
    </div>
  );
}
