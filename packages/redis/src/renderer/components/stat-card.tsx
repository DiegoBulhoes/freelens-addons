export type Tone = "critical" | "warning" | "info" | "ok";

export function StatCard({
  value,
  label,
  tone,
  onOpen,
}: {
  value: number;
  label: string;
  tone?: Tone;
  onOpen?: () => void;
}) {
  const className = `Redis-card${tone && value > 0 ? ` Redis-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="Redis-card__value">{value}</span>
      <span className="Redis-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} onClick={onOpen}>
      {content}
    </button>
  );
}
