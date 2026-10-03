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
  const className = `__Name__-card${tone && value > 0 ? ` __Name__-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="__Name__-card__value">{value}</span>
      <span className="__Name__-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} onClick={onOpen}>
      {content}
    </button>
  );
}
