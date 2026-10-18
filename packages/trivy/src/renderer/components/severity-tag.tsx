import type { Severity } from "../api/shared/types";

export function SeverityTag({ severity }: { severity: Severity | undefined }) {
  return (
    <span className={`Trivy-tag Trivy-severity--${severity ?? "UNKNOWN"}`}>
      {severity ?? "UNKNOWN"}
    </span>
  );
}
