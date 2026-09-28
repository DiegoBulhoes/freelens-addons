export type Tone = "critical" | "warning" | "info" | "ok";

/**
 * One number and what it counts. A card that can be pressed is a `<button>` —
 * for the keyboard and the screen reader — and takes the operator to the list
 * the number summarises; one that cannot is a plain block.
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
  // A count of problems is only alarming when there is one.
  const className = `CertManager-card${tone && value > 0 ? ` CertManager-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="CertManager-card__value">{value}</span>
      <span className="CertManager-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} onClick={onOpen}>
      {content}
    </button>
  );
}
