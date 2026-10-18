import { useState } from "react";

import { cutTo } from "../api/shared/cut";
import type { PackageUpgrade } from "../api/vulnerabilities/findings";
import { SeverityTag } from "../components/severity-tag";
import { ShowAll } from "../components/show-all";

const MAX_SHOWN = 12;

export function PackageTable({ upgrades }: { upgrades: PackageUpgrade[] }) {
  const [all, setAll] = useState(false);

  if (upgrades.length === 0) {
    return (
      <p className="Trivy-section__note">No upgrade clears a critical or high finding here.</p>
    );
  }

  const { shown, hidden } = cutTo(upgrades, MAX_SHOWN, all);

  return (
    <>
      <table className="Trivy-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Upgrade</th>
            <th className="Trivy-table__number">Clears</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((upgrade) => (
            <tr key={`${upgrade.resource}@${upgrade.installedVersion}`}>
              <td className="Trivy-table__shrink">
                <SeverityTag severity={upgrade.worstSeverity} />{" "}
                <code>{upgrade.resource || "—"}</code>
              </td>
              <td className="Trivy-muted">
                <code>
                  {upgrade.installedVersion} → {upgrade.fixedVersion}
                </code>
              </td>
              <td className="Trivy-table__number">{upgrade.vulnerabilityCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ShowAll
        hidden={hidden}
        total={upgrades.length}
        what="packages with a fix for a critical or high finding"
        onShowAll={() => setAll(true)}
      />
    </>
  );
}
