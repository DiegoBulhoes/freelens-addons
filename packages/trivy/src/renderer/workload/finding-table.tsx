import { hasFix, identityOf, sortBySeverity } from "../api/findings";
import type { Vulnerability } from "../api/types";

const MAX_SHOWN = 100;

/** The raw findings, for when the packages view is not what is wanted. */
export function FindingTable({ vulnerabilities }: { vulnerabilities: Vulnerability[] }) {
  const shown = sortBySeverity(vulnerabilities).slice(0, MAX_SHOWN);

  return (
    <>
      <table className="Trivy-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>CVE</th>
            <th>Package</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((finding) => (
            <tr key={identityOf(finding)}>
              <td className="Trivy-table__shrink">
                <span className={`Trivy-tag Trivy-severity--${finding.severity ?? "UNKNOWN"}`}>
                  {finding.severity ?? "UNKNOWN"}
                </span>
              </td>
              <td className="Trivy-table__shrink">
                {finding.primaryLink ? (
                  <a href={finding.primaryLink} target="_blank" rel="noreferrer">
                    {finding.vulnerabilityID}
                  </a>
                ) : (
                  <code>{finding.vulnerabilityID}</code>
                )}
              </td>
              <td className="Trivy-muted">
                <code>{finding.resource}</code>
              </td>
              <td className="Trivy-table__shrink Trivy-muted">
                {hasFix(finding) ? <code>{finding.fixedVersion}</code> : "none published"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {vulnerabilities.length > shown.length && (
        <p className="Trivy-section__note">
          Showing {shown.length} of {vulnerabilities.length}. Narrow it with the filters above.
        </p>
      )}
    </>
  );
}
