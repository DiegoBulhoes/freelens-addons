import type { CoverageEntry, CoverageTally } from "../api/coverage";

const MAX_LISTED = 8;

const STATE_LABEL = {
  scanned: "scanned",
  "read-but-no-verdict": "no verdict",
  "never-looked": "not looked at",
} as const;

const TONE = {
  scanned: "ok",
  "read-but-no-verdict": "warning",
  "never-looked": "critical",
} as const;

/**
 * The part of the page that exists because the Lens list of reports cannot show
 * it: workloads with no VulnerabilityReport, which that list renders as nothing
 * at all.
 */
export function CoverageSection({
  counts,
  unjudged,
  onOpenWorkload,
}: {
  counts: CoverageTally;
  unjudged: CoverageEntry[];
  onOpenWorkload: (entry: CoverageEntry) => void;
}) {
  // Nothing waiting is already the headline's subline; an empty title here read as a
  // section that failed to load.
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
            className={`Trivy-row Trivy-row--${TONE[entry.state]}`}
            onClick={() => onOpenWorkload(entry)}
          >
            <span className="Trivy-row__state">{STATE_LABEL[entry.state]}</span>
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
