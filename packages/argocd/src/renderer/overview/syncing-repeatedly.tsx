import { Renderer } from "@freelensapp/extensions";

import type { Application } from "../api/application";
import type { RepeatedSync } from "../api/overview";
import { ApplicationMenuItem } from "../menus/application-menu";

const {
  Component: { MenuActions },
} = Renderer;

export function SyncingRepeatedly({
  repeated,
  onMarksChanged,
  onOpen,
}: {
  repeated: RepeatedSync[];
  onMarksChanged: () => void;
  onOpen: (application: Application) => void;
}) {
  return (
    <section className="ArgoCD-section">
      <h2 className="ArgoCD-section__title">Syncing repeatedly</h2>
      <p className="ArgoCD-section__note">
        Deployed several times in the last hour. Each deploy can succeed, so ArgoCD reports no
        failure. Usually something keeps changing the live state back. A "+" means ArgoCD's history
        is full and the real count is higher.
      </p>
      <div className="ArgoCD-list">
        {repeated.map((entry) => (
          <div key={entry.name} className="ArgoCD-row ArgoCD-row--warning">
            <span className="ArgoCD-row__state">Repeating</span>
            <button
              type="button"
              className="ArgoCD-row__main"
              title="Opens it in the Applications list, with its details"
              onClick={() => onOpen(entry.application)}
            >
              <span className="ArgoCD-row__name">
                <b>{entry.name}</b>
              </span>
            </button>
            <span className="ArgoCD-row__aside">
              {entry.count}
              {entry.capped ? "+" : ""} deploys in the last hour
            </span>
            <span className="ArgoCD-row__actions">
              <MenuActions toolbar={false} autoCloseOnSelect>
                <ApplicationMenuItem object={entry.application} onChanged={onMarksChanged} />
              </MenuActions>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
