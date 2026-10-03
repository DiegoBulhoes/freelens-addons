import { countOf } from "../api/severity";
import { subjectKey } from "../api/subjects";
import type { ReportSubject } from "../api/types";
import type { WorkloadRow } from "../api/workload-rows";

export function ExposureSection({
  rows,
  total,
  onOpenWorkload,
  onOpenAll,
}: {
  rows: WorkloadRow[];
  total: number;
  onOpenWorkload: (subject: ReportSubject) => void;
  onOpenAll: () => void;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="Trivy-section">
      <div className="Trivy-section__bar">
        <h2 className="Trivy-section__title">Most exposed</h2>
        <button
          type="button"
          className="Trivy-link"
          title="Opens Workloads with every workload listed"
          onClick={onOpenAll}
        >
          All {total} workloads
        </button>
      </div>

      <div className="Trivy-list">
        {rows.map((row) => {
          const criticals = countOf(row.summary, "CRITICAL");
          const highs = countOf(row.summary, "HIGH");

          return (
            <button
              type="button"
              key={subjectKey(row.subject)}
              className={`Trivy-row Trivy-row--${criticals > 0 ? "critical" : "warning"}`}
              title="Opens this workload in Workloads, with the upgrades that clear its findings"
              onClick={() => onOpenWorkload(row.subject)}
            >
              <span className="Trivy-row__state">
                {criticals > 0 ? `${criticals} critical` : `${highs} high`}
              </span>
              <span className="Trivy-row__main">
                <span className="Trivy-row__name">
                  <b>{row.subject.name}</b>
                  <span className="Trivy-row__meta">
                    {row.subject.namespace} · {row.subject.kind}
                  </span>
                </span>
              </span>
              {criticals > 0 && highs > 0 && <span className="Trivy-row__aside">{highs} high</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
