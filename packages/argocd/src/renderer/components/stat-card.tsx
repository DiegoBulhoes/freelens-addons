import type { Tone } from "./status";

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
  const className = `ArgoCD-card${tone && value > 0 ? ` ArgoCD-card--${tone}` : ""}`;
  const content = (
    <>
      <span className="ArgoCD-card__value">{value}</span>
      <span className="ArgoCD-card__label">{label}</span>
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} title={title} onClick={onOpen}>
      {content}
    </button>
  );
}
