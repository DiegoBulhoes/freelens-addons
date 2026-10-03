import type { Tone } from "./status";

export function StatCard({
  value,
  label,
  tone,
  onOpen,
  title,
}: {
  value: number;
  label: string;
  tone?: Tone;
  onOpen?: () => void;
  title?: string;
}) {
  const className = `CertManager-card${tone && value > 0 ? ` CertManager-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="CertManager-card__value">{value}</span>
      <span className="CertManager-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} title={title} onClick={onOpen}>
      {content}
    </button>
  );
}
