export type Tone = "critical" | "warning" | "info" | "ok";

/**
 * One number and what it counts. A card that can be pressed is a `<button>` —
 * for the keyboard and the screen reader — and opens the list the number
 * summarises; one that cannot is a plain block.
 */
export function StatCard({
  label,
  value,
  tone,
  onOpen,
}: {
  label: string;
  value: number;
  tone?: Tone;
  onOpen?: () => void;
}) {
  // A count of problems is only alarming when there is one.
  const className = `ArgoCD-card${tone && value > 0 ? ` ArgoCD-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="ArgoCD-card__value">{value}</span>
      <span className="ArgoCD-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} onClick={onOpen}>
      {content}
    </button>
  );
}
