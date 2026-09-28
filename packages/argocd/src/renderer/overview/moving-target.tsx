import { Renderer } from "@freelensapp/extensions";

import { type SourceExposure, shortenRepo } from "../api/sources";

const {
  Component: { Icon },
} = Renderer;

const MAX_NAMES_SHOWN = 3;

const MAX_GROUPS_SHOWN = 8;

export function MovingTarget({
  exposure,
  onCopyNames,
}: {
  exposure: SourceExposure;
  onCopyNames: (names: string[]) => void;
}) {
  return (
    <section className="ArgoCD-section">
      <h2 className="ArgoCD-section__title">Applications on a moving reference</h2>
      <p className="ArgoCD-section__note">
        {exposure.exposed} of {exposure.total} Applications follow a branch or a version range
        instead of a fixed tag or commit. With auto-sync on, they deploy whatever lands there next,
        whenever it lands. The count is how many Applications one push to that reference deploys.
      </p>

      <table className="ArgoCD-table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Reference</th>
            <th>Applications</th>
            <th aria-label="Copy" />
          </tr>
        </thead>
        <tbody>
          {exposure.moving.slice(0, MAX_GROUPS_SHOWN).map((group) => (
            <tr key={`${group.repoURL}-${group.chart ?? ""}-${group.targetRevision}`}>
              <td className="ArgoCD-table__shrink" title={group.repoURL}>
                {shortenRepo(group.repoURL)}
                {group.chart && <span className="ArgoCD-muted"> · {group.chart}</span>}
              </td>
              <td className="ArgoCD-table__shrink ArgoCD-mono">{group.targetRevision}</td>
              <td className="ArgoCD-table__fill">
                <b>{group.applications.length}</b>
                <span className="ArgoCD-muted">
                  {": "}
                  {group.applications
                    .slice(0, 3)
                    .map((application) => application.getName())
                    .join(", ")}
                  {group.applications.length > MAX_NAMES_SHOWN &&
                    ` +${group.applications.length - MAX_NAMES_SHOWN}`}
                </span>
              </td>
              <td className="ArgoCD-table__shrink">
                <button
                  type="button"
                  className="ArgoCD-icon-button"
                  title="Copy the Application names"
                  onClick={() =>
                    onCopyNames(group.applications.map((application) => application.getName()))
                  }
                >
                  <Icon small material="content_copy" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
