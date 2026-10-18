import { observer } from "mobx-react";

import type { OpenPage } from "../api/overview/attention";
import { loadedBy, type RuleRow } from "../api/rules/rules";
import { type LinkTarget, ruleFacts } from "../api/shared/facts";
import { commandsFor, type Fix } from "../api/shared/fixes";
import { describeSource } from "../api/shared/selection";
import type { Alert } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { CommandsSection, FixSection, fixActions } from "../components/commands-section";
import { followLink } from "../components/drawer-link";
import { ObjectFacts } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";

const otherLabels = (alert: Alert) =>
  Object.entries(alert.labels)
    .filter(([key]) => key !== "alertname")
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");

function AlertsSection({ row, now }: { row: RuleRow; now: number }) {
  const alerts = [...row.firing, ...row.pending];

  return (
    <section className="Prometheus-section" data-section="prometheus-rule-alerts">
      <h3 className="Prometheus-section__title">Alerts</h3>
      {alerts.length === 0 ? (
        <p className="Prometheus-section__note">
          {loadedBy(row).length > 0
            ? "None firing or pending."
            : "Not known: no Prometheus that loads it was read."}
        </p>
      ) : (
        <div className="Prometheus-list">
          {alerts.map((alert) => (
            <div
              key={JSON.stringify(alert.labels)}
              className={`Prometheus-row Prometheus-row--${alert.state === "firing" ? "warning" : "info"}`}
            >
              <span className="Prometheus-row__state">
                {alert.state === "firing" ? "Firing" : "Pending"}
              </span>
              <span className="Prometheus-row__main">
                <span className="Prometheus-row__name">
                  <b>{alert.labels.alertname ?? "—"}</b>
                  <span className="Prometheus-row__meta">since {ago(alert.activeAt, now)}</span>
                </span>
                <span className="Prometheus-row__reason">
                  {alert.annotations?.summary ?? (otherLabels(alert) || "No labels")}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export const RuleDrawer = observer(
  ({
    row,
    fixes,
    onClose,
    open,
  }: {
    row?: RuleRow;
    fixes: Fix[];
    onClose: () => void;
    open: OpenPage;
  }) => {
    const now = Date.now();
    const follow = (to: LinkTarget) => followLink(to, onClose, open);

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind="PrometheusRule"
        name={row?.name ?? ""}
        onClose={onClose}
        state={row?.verdict}
        section="prometheus-rule"
        actions={fixActions(fixes)}
      >
        {row && (
          <>
            <ObjectFacts
              namespace={row.namespace}
              verdict={row.verdict}
              facts={ruleFacts(row, now)}
              created={row.rule.metadata.creationTimestamp}
              onFollow={follow}
            />

            <AlertsSection row={row} now={now} />

            {row.unhealthy.length > 0 && (
              <section className="Prometheus-section" data-section="prometheus-rule-failing">
                <h3 className="Prometheus-section__title">Failing to evaluate</h3>
                <div className="Prometheus-list">
                  {row.unhealthy.map((each) => (
                    <div key={each.name} className="Prometheus-row Prometheus-row--critical">
                      <span className="Prometheus-row__main">
                        <span className="Prometheus-row__name">
                          <b>{each.name}</b>
                        </span>
                        <span className="Prometheus-row__reason">
                          {each.lastError || "No error given"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="Prometheus-section" data-section="prometheus-rule-groups">
              <h3 className="Prometheus-section__title">Groups</h3>
              <div className="Prometheus-list">
                {(row.rule.spec.groups ?? []).map((group) => (
                  <div key={group.name} className="Prometheus-row">
                    <span className="Prometheus-row__main">
                      <span className="Prometheus-row__name">
                        <b>{group.name}</b>
                        {group.interval && (
                          <span className="Prometheus-row__meta">every {group.interval}</span>
                        )}
                      </span>
                      <span className="Prometheus-row__reason">
                        {(group.rules ?? []).map((each) => each.alert ?? each.record).join(", ") ||
                          "No rules"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              {row.live
                .filter((view) => view.error)
                .map((view) => (
                  <p key={view.source.key} className="Prometheus-section__note">
                    {describeSource(view.source)}: {view.error}
                  </p>
                ))}
            </section>

            <FixSection fixes={fixes} section="prometheus-rule-fix" />

            <CommandsSection commands={commandsFor(row)} section="prometheus-rule-commands" />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
