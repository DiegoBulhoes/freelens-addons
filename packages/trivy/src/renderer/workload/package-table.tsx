import type { PackageUpgrade } from "../api/findings";

const MAX_SHOWN = 12;

export function PackageTable({ upgrades }: { upgrades: PackageUpgrade[] }) {
  if (upgrades.length === 0) {
    return <p className="Trivy-section__note">No package here has a published fix.</p>;
  }

  const shown = upgrades.slice(0, MAX_SHOWN);

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
                <span className={`Trivy-tag Trivy-severity--${upgrade.worstSeverity}`}>
                  {upgrade.worstSeverity}
                </span>{" "}
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

      {upgrades.length > shown.length && (
        <p className="Trivy-section__note">
          and {upgrades.length - shown.length} more packages with a published fix.
        </p>
      )}
    </>
  );
}
