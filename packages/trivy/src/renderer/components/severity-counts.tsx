import { countOf } from "../api/severity";
import type { Severity, SeveritySummary } from "../api/types";

const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

export function SeverityCounts({ summary }: { summary?: SeveritySummary }) {
  const present = SEVERITIES.filter((severity) => countOf(summary, severity) > 0);

  if (present.length === 0) return <>none</>;

  return (
    <>
      {present.map((severity, index) => (
        <span key={severity}>
          {index > 0 && " · "}
          <span className={`Trivy-severity--${severity}`}>
            {countOf(summary, severity)} {severity.toLowerCase()}
          </span>
        </span>
      ))}
    </>
  );
}
