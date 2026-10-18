export type Tone = "critical" | "warning" | "info" | "ok";

export function StatCard({
  value,
  label,
  tone,
  onOpen,
  title = `Opens the list behind ${label}`,
}: {
  value: number;
  label: string;
  tone?: Tone;
  onOpen?: () => void;
  title?: string;
}) {
  const className = `Prometheus-card${tone && value > 0 ? ` Prometheus-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="Prometheus-card__value">{value}</span>
      <span className="Prometheus-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} title={title} onClick={onOpen}>
      {content}
    </button>
  );
}
