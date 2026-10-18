import { useState } from "react";
import { cutTo } from "../api/shared/cut";
import type { Vulnerability } from "../api/shared/types";
import { findingLink } from "../api/vulnerabilities/check-link";
import { hasFix, identityOf, sortBySeverity } from "../api/vulnerabilities/findings";
import { SeverityTag } from "../components/severity-tag";
import { ShowAll } from "../components/show-all";

const MAX_SHOWN = 100;

export function FindingTable({
  vulnerabilities,
  empty,
}: {
  vulnerabilities: Vulnerability[];
  empty: string;
}) {
  const [all, setAll] = useState(false);

  if (vulnerabilities.length === 0) return <p className="Trivy-section__note">{empty}</p>;

  const { shown, hidden } = cutTo(sortBySeverity(vulnerabilities), MAX_SHOWN, all);

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
          {shown.map((finding) => {
            const link = findingLink(finding.primaryLink);

            return (
              <tr key={identityOf(finding)}>
                <td className="Trivy-table__shrink">
                  <SeverityTag severity={finding.severity} />
                </td>
                <td className="Trivy-table__shrink">
                  {link ? (
                    <a
                      className="Trivy-link"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the advisory for this CVE"
                    >
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
            );
          })}
        </tbody>
      </table>

      <ShowAll
        hidden={hidden}
        total={vulnerabilities.length}
        what="findings"
        onShowAll={() => setAll(true)}
      />
    </>
  );
}
