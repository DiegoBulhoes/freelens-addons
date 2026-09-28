import { shortenRevision } from "../api/application";
import type { DeployCohort } from "../api/insights";
import { since } from "./elapsed";

const MAX_NAMES_SHOWN = 3;

const MAX_COHORTS_SHOWN = 10;

export function RecentRollouts({ cohorts }: { cohorts: DeployCohort[] }) {
  return (
    <section className="ArgoCD-section">
      <h2 className="ArgoCD-section__title">Recent rollouts</h2>
      {cohorts.length === 0 ? (
        <p className="ArgoCD-section__note">No Application has recorded a deploy yet.</p>
      ) : (
        <table className="ArgoCD-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Revision</th>
              <th>Applications</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.slice(0, MAX_COHORTS_SHOWN).map((cohort) => (
              <tr key={`${cohort.revision}-${cohort.at}`}>
                <td className="ArgoCD-table__shrink ArgoCD-muted">
                  {since(new Date(cohort.at).toISOString())}
                </td>
                <td className="ArgoCD-table__shrink ArgoCD-mono">
                  {shortenRevision(cohort.revision)}
                </td>
                <td className="ArgoCD-table__fill">
                  {cohort.entries.length === 1 ? (
                    cohort.entries[0]?.application.getName()
                  ) : (
                    <>
                      <b>{cohort.entries.length}</b> Applications
                      <span className="ArgoCD-muted">
                        {": "}
                        {cohort.entries
                          .slice(0, 3)
                          .map((entry) => entry.application.getName())
                          .join(", ")}
                        {cohort.entries.length > MAX_NAMES_SHOWN &&
                          ` +${cohort.entries.length - MAX_NAMES_SHOWN}`}
                      </span>
                    </>
                  )}
                </td>
                <td className="ArgoCD-table__shrink ArgoCD-muted">{cohort.entries[0]?.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
