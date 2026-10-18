import type { Application } from "../api/applications/application";
import type { DeployCohort } from "../api/applications/insights";
import { shortenRevision } from "../api/applications/revisions";
import { firstFew } from "../api/shared/table";
import { ApplicationNames } from "./application-names";
import { since } from "./elapsed";

const MAX_COHORTS_SHOWN = 10;

export function RecentRollouts({
  cohorts,
  onOpen,
}: {
  cohorts: DeployCohort[];
  onOpen: (application: Application) => void;
}) {
  return (
    <section className="ArgoCD-section" data-section="recent-rollouts">
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
            {firstFew(cohorts, MAX_COHORTS_SHOWN).shown.map((cohort) => (
              <tr key={`${cohort.revision}-${cohort.at}`}>
                <td className="ArgoCD-table__shrink ArgoCD-muted">
                  {since(new Date(cohort.at).toISOString())}
                </td>
                <td className="ArgoCD-table__shrink ArgoCD-mono">
                  {shortenRevision(cohort.revision)}
                </td>
                <td className="ArgoCD-table__fill">
                  {cohort.entries.length > 1 && (
                    <>
                      <b>{cohort.entries.length}</b> Applications:{" "}
                    </>
                  )}
                  <ApplicationNames
                    applications={cohort.entries.map((entry) => entry.application)}
                    onOpen={onOpen}
                  />
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
