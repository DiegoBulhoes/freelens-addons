import { observer } from "mobx-react";
import { Fragment } from "react";
import {
  type ApplicationSetRow,
  conditionRows,
  describeGenerator,
  describeSyncPolicy,
  type GeneratorView,
  templateDestination,
  templateSources,
} from "../api/application-sets/application-set";
import { Application } from "../api/applications/application";
import { DrawerLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { HealthBadge, SyncBadge } from "../components/status";

function Generator({ view }: { view: GeneratorView }) {
  return (
    <section className="ArgoCD-box">
      <div className="ArgoCD-box__head">
        <span className="ArgoCD-box__title">
          <b>{view.kind}</b>
          {view.summary && <span className="ArgoCD-box__meta">{view.summary}</span>}
        </span>
      </div>
      {view.fields.length > 0 && (
        <dl className="ArgoCD-facts">
          {view.fields.map((field) => (
            <Fragment key={field.name}>
              <dt>{field.name}</dt>
              <dd className="ArgoCD-mono">{field.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {view.nested.map((nested, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: generators have no name, and two may be alike.
        <Generator key={`${nested.kind}/${index}`} view={nested} />
      ))}
    </section>
  );
}

interface ApplicationSetDrawerProps {
  row?: ApplicationSetRow;
  onClose: () => void;
  onOpenApplication: (application: Application) => void;
}

export const ApplicationSetDrawer = observer(
  ({ row, onClose, onOpenApplication }: ApplicationSetDrawerProps) => {
    const set = row?.set;
    const sources = set ? templateSources(set) : [];
    const template = set?.spec.template;

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind="ApplicationSet"
        name={set?.getName() ?? ""}
        onClose={onClose}
        state={row?.verdict}
        section="application-set"
      >
        {row && set && (
          <>
            <dl className="ArgoCD-facts">
              <dt>Namespace</dt>
              <dd>{set.getNs()}</dd>
              <dt>Applications</dt>
              <dd>
                {row.summary.count === undefined
                  ? row.summary.label
                  : `${row.summary.count} · ${row.summary.label}`}
              </dd>
              <dt>Templating</dt>
              <dd>{set.spec.goTemplate ? "Go templates" : "fasttemplate"}</dd>
              {describeSyncPolicy(set).map(({ label, value }) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
            </dl>

            <section className="ArgoCD-section" data-section="application-set-generators">
              <h3 className="ArgoCD-section__title">Generators</h3>
              {(set.spec.generators ?? []).length === 0 ? (
                <p className="ArgoCD-section__note">
                  It names no generator, so it generates nothing.
                </p>
              ) : (
                (set.spec.generators ?? []).map((generator, index) => {
                  const view = describeGenerator(generator);

                  // biome-ignore lint/suspicious/noArrayIndexKey: generators have no name, and two may be alike.
                  return <Generator key={`${view.kind}/${index}`} view={view} />;
                })
              )}
            </section>

            <section className="ArgoCD-section" data-section="application-set-template">
              <h3 className="ArgoCD-section__title">Template</h3>
              <dl className="ArgoCD-facts">
                <dt>Name</dt>
                <dd className="ArgoCD-mono">{template?.metadata?.name ?? "—"}</dd>
                <dt>Project</dt>
                <dd className="ArgoCD-mono">{template?.spec?.project ?? "—"}</dd>
                {sources.map((source, index) => (
                  // Sources have no id of their own; two can share a repoURL at different paths.
                  <Fragment key={`${source.repoURL}/${source.path ?? source.chart ?? index}`}>
                    <dt>{sources.length === 1 ? "Source" : `Source ${index + 1}`}</dt>
                    <dd className="ArgoCD-mono">
                      {source.repoURL ?? "—"}
                      {source.chart
                        ? ` chart ${source.chart}`
                        : source.path
                          ? ` ${source.path}`
                          : ""}
                      {source.targetRevision ? ` @ ${source.targetRevision}` : ""}
                    </dd>
                  </Fragment>
                ))}
                <dt>Destination</dt>
                <dd className="ArgoCD-mono">{templateDestination(set)}</dd>
              </dl>
            </section>

            <section className="ArgoCD-section" data-section="application-set-applications">
              <h3 className="ArgoCD-section__title">Applications</h3>
              {row.summary.count === undefined ? (
                <p className="ArgoCD-section__note">
                  The Applications in the namespaces in scope could not be read.
                </p>
              ) : row.owned.length === 0 ? (
                <p className="ArgoCD-section__note">
                  It owns no Application in the namespaces in scope.
                </p>
              ) : (
                <div className="ArgoCD-list">
                  {row.owned.map((application) => (
                    <div key={application.getId()} className="ArgoCD-row">
                      <span className="ArgoCD-row__main">
                        <span className="ArgoCD-row__name">
                          <DrawerLink
                            label={application.getName()}
                            title="Opens it in the Applications list, with its details"
                            onOpen={() => onOpenApplication(application)}
                          />
                          <span className="ArgoCD-row__meta">
                            {Application.getDestination(application)}
                          </span>
                        </span>
                      </span>
                      <span className="ArgoCD-row__aside">
                        <SyncBadge status={Application.getSyncStatus(application)} />{" "}
                        <HealthBadge
                          status={Application.getHealthStatus(application)}
                          message={Application.getHealthMessage(application)}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="ArgoCD-section" data-section="application-set-conditions">
              <h3 className="ArgoCD-section__title">Conditions</h3>
              {conditionRows(set).length === 0 ? (
                <p className="ArgoCD-section__note">The controller has reported none yet.</p>
              ) : (
                <div className="ArgoCD-list">
                  {conditionRows(set).map((condition) => (
                    <div
                      key={condition.type}
                      className={`ArgoCD-row${condition.failing ? " ArgoCD-row--critical" : ""}`}
                    >
                      <span className="ArgoCD-row__main">
                        <span className="ArgoCD-row__name">
                          <b>{condition.type}</b>
                          <span className="ArgoCD-row__meta">
                            {condition.status}
                            {condition.reason && ` · ${condition.reason}`}
                          </span>
                        </span>
                        {condition.message && (
                          <span className="ArgoCD-row__reason">{condition.message}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </ObjectDrawer>
    );
  },
);
