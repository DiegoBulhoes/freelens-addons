export function LoadGaps({ gaps }: { gaps: string[] }) {
  if (gaps.length === 0) return null;

  return (
    <>
      {gaps.map((gap) => (
        <div key={gap} className="Trivy-banner Trivy-banner--critical" data-section="load-gaps">
          <span className="Trivy-banner__title">{gap}</span>
        </div>
      ))}
    </>
  );
}
