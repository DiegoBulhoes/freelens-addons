import { COVERAGE_STATUS } from "../api/coverage";
import { countOf } from "../api/severity";
import { subjectKey } from "../api/subjects";
import type { ReportSubject } from "../api/types";
import type { WorkloadRow } from "../api/workload-rows";
import { Status } from "../components/status";

export function WorkloadList({
  rows,
  selected,
  onSelect,
}: {
  rows: WorkloadRow[];
  selected?: ReportSubject;
  onSelect: (subject: ReportSubject) => void;
}) {
  const selectedKey = selected ? subjectKey(selected) : undefined;

  return (
    <div className="Trivy-picker__list">
      {rows.map((row) => {
        const key = subjectKey(row.subject);
        const criticals = countOf(row.summary, "CRITICAL");
        const highs = countOf(row.summary, "HIGH");

        return (
          <button
            type="button"
            key={key}
            className={`Trivy-picker__item${key === selectedKey ? " Trivy-picker__item--selected" : ""}`}
            title="Shows this workload's findings beside the list"
            onClick={() => onSelect(row.subject)}
          >
            <span className="Trivy-picker__name">{row.subject.name}</span>
            <span className="Trivy-picker__meta">
              {row.subject.namespace} ·{" "}
              <Status
                tone={COVERAGE_STATUS[row.state].tone}
                label={COVERAGE_STATUS[row.state].label}
              />
            </span>
            {(criticals > 0 || highs > 0) && (
              <span
                className="Trivy-picker__aside"
                title="Findings in its vulnerability report, by severity"
              >
                {criticals > 0 && (
                  <span className="Trivy-severity--CRITICAL">{criticals} critical</span>
                )}
                {highs > 0 && <span className="Trivy-severity--HIGH">{highs} high</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
