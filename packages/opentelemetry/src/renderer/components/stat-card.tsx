export type Tone = "critical" | "warning" | "info" | "ok";

export function StatCard({
  value,
  label,
  tone,
  onOpen,
  title = `Opens the list behind ${label}`,
}: {
  value?: number;
  label: string;
  tone?: Tone;
  onOpen?: () => void;
  title?: string;
}) {
  const className = `OpenTelemetry-card${tone && value !== undefined && value > 0 ? ` OpenTelemetry-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="OpenTelemetry-card__value">{value ?? "—"}</span>
      <span className="OpenTelemetry-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} title={title} onClick={onOpen}>
      {content}
    </button>
  );
}
