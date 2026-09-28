import { countOf } from "../api/severity";
import { subjectKey } from "../api/subjects";
import type { ReportSubject } from "../api/types";
import type { WorkloadRow } from "../api/workload-rows";

const STATE_LABEL = {
  scanned: "scanned",
  "read-but-no-verdict": "no verdict",
  "never-looked": "not looked at",
} as const;

const TONE = {
  scanned: "Trivy-muted",
  "read-but-no-verdict": "Trivy-text--warning",
  "never-looked": "Trivy-text--critical",
} as const;

/** The selectable column. Narrow on purpose: the detail beside it is the content. */
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
            onClick={() => onSelect(row.subject)}
          >
            <span className="Trivy-picker__name">{row.subject.name}</span>
            <span className="Trivy-picker__meta">
              {row.subject.namespace}
              <span className={TONE[row.state]}> · {STATE_LABEL[row.state]}</span>
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
