import type { Tone } from "../components/status";

export type { Tone };

export function StatCard({
  label,
  value,
  tone,
  onOpen,
  title = `Opens the list behind ${label}`,
}: {
  label: string;
  value: number;
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
