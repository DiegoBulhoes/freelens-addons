export type Tone = "critical" | "warning" | "info" | "ok";

/**
 * One number and what it counts. A card that can be pressed is a `<button>` —
 * for the keyboard and the screen reader — and opens the list the number
 * summarises; one that cannot is a plain block. A count of problems is only
 * alarming when there is one, so the tone applies above zero.
 */
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
