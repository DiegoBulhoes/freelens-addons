import { COVERAGE_STATUS, type CoverageEntry, type CoverageTally } from "../api/coverage";

const MAX_LISTED = 8;

export function CoverageSection({
  counts,
  unjudged,
  onOpenWorkload,
}: {
  counts: CoverageTally;
  unjudged: CoverageEntry[];
  onOpenWorkload: (entry: CoverageEntry) => void;
}) {
  // An empty section here read as one that failed to load.
  if (counts.total === 0 || unjudged.length === 0) return null;

  const listed = unjudged.slice(0, MAX_LISTED);

  return (
    <section className="Trivy-section">
      <h2 className="Trivy-section__title">Waiting on a verdict</h2>

      <div className="Trivy-list">
        {listed.map((entry) => (
          <button
            type="button"
            key={`${entry.subject.namespace}/${entry.subject.kind}/${entry.subject.name}`}
            className={`Trivy-row Trivy-row--${COVERAGE_STATUS[entry.state].tone}`}
            title="Opens this workload's drawer in Workloads"
            onClick={(event) => {
              // Unprevented, the drawer this opens takes the click as outside and closes.
              event.preventDefault();
              onOpenWorkload(entry);
            }}
          >
            <span className="Trivy-row__state">{COVERAGE_STATUS[entry.state].label}</span>
            <span className="Trivy-row__main">
              <span className="Trivy-row__name">
                <b>{entry.subject.name}</b>
                <span className="Trivy-row__meta">
                  {entry.subject.namespace} · {entry.subject.kind}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {unjudged.length > listed.length && (
        <p className="Trivy-section__note">
          and {unjudged.length - listed.length} more with no vulnerability verdict.
        </p>
      )}
    </section>
  );
}
