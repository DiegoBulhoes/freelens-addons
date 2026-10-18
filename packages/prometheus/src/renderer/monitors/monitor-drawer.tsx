import { observer } from "mobx-react";
import { type LiveView, type MonitorRow, targetHostKind } from "../api/monitors/monitors";
import { keyedTargets, shownInstance } from "../api/monitors/scrape-pools";
import type { OpenPage } from "../api/overview/attention";
import { endpointFacts, type LinkTarget, monitorFacts } from "../api/shared/facts";
import { commandsFor, type Fix } from "../api/shared/fixes";
import { describeSource } from "../api/shared/selection";
import type { Target } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { CommandsSection, FixSection, fixActions } from "../components/commands-section";
import { followLink } from "../components/drawer-link";
import { Facts, ObjectFacts } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";
import { Status, type Tone } from "../components/status";

const HEALTH: Record<Target["health"], { tone: Tone; label: string }> = {
  up: { tone: "ok", label: "Up" },
  down: { tone: "critical", label: "Down" },
  unknown: { tone: "info", label: "Not scraped yet" },
};

function LiveSection({ view, now }: { view: LiveView; now: number }) {
  const targets = view.health?.targets ?? [];
  const allocator = view.source.kind === "TargetAllocator";

  return (
    <div className="Prometheus-box">
      <div className="Prometheus-box__title">
        <b>{describeSource(view.source)}</b>
        <span className="Prometheus-box__meta">
          {view.error
            ? "not read"
            : allocator
              ? view.loaded
                ? "has a job for it"
                : "no job for it"
              : view.loaded === false
                ? "no scrape pool for it"
                : `${targets.length} target${targets.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {view.error ? (
        <p className="Prometheus-box__reason">{view.error}</p>
      ) : allocator ? (
        <p className="Prometheus-box__reason">
          {view.loaded
            ? "It hands this monitor's targets to its collector, whose own metrics tell their health."
            : "It has no job for this monitor: it was not loaded or discovered no target; its logs say why."}
        </p>
      ) : targets.length === 0 ? (
        <p className="Prometheus-box__reason">
          {view.loaded === false
            ? "It has not loaded this monitor; the operator's Events or its logs say why."
            : "It discovered no target for this monitor."}
        </p>
      ) : (
        <div className="Prometheus-list">
          {keyedTargets(targets).map(({ key, target }) => (
            <div
              key={key}
              className={`Prometheus-row Prometheus-row--${HEALTH[target.health].tone}`}
            >
              <span className="Prometheus-row__main">
                <span className="Prometheus-row__name">
                  <Status tone={HEALTH[target.health].tone} label={HEALTH[target.health].label} />
                  <code>{target.scrapeUrl}</code>
                  {shownInstance(target) && (
                    <span className="Prometheus-row__meta">{shownInstance(target)}</span>
                  )}
                  <span className="Prometheus-row__meta">
                    {target.lastScrape ? `scraped ${ago(target.lastScrape, now)}` : "never scraped"}
                  </span>
                </span>
                <span className="Prometheus-row__reason">
                  {target.lastError || `Pool ${target.scrapePool}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const MonitorDrawer = observer(
  ({
    row,
    fixes,
    onClose,
    open,
  }: {
    row?: MonitorRow;
    fixes: Fix[];
    onClose: () => void;
    open: OpenPage;
  }) => {
    const now = Date.now();
    const follow = (to: LinkTarget) => followLink(to, onClose, open);

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind={row?.kind ?? "Monitor"}
        name={row?.name ?? ""}
        onClose={onClose}
        state={row?.verdict}
        section="prometheus-monitor"
        actions={fixActions(fixes)}
      >
        {row && (
          <>
            <ObjectFacts
              namespace={row.namespace}
              verdict={row.verdict}
              facts={monitorFacts(row)}
              created={row.monitor.metadata.creationTimestamp}
              onFollow={follow}
            />

            {row.checks.length > 0 && (
              <section className="Prometheus-section" data-section="prometheus-monitor-endpoints">
                <h3 className="Prometheus-section__title">In Kubernetes</h3>
                {row.checks.map((check) => (
                  <dl key={check.index} className="Prometheus-facts">
                    <dt>Endpoint</dt>
                    <dd>{check.index}</dd>
                    <Facts
                      facts={endpointFacts(check, targetHostKind(row.kind))}
                      onFollow={follow}
                    />
                  </dl>
                ))}
              </section>
            )}

            <section className="Prometheus-section" data-section="prometheus-monitor-live">
              <h3 className="Prometheus-section__title">What Prometheus says</h3>
              {row.live.length === 0 ? (
                <p className="Prometheus-section__note">
                  Nothing selects it, so nothing scrapes it.
                </p>
              ) : (
                row.live.map((view) => <LiveSection key={view.source.key} view={view} now={now} />)
              )}
            </section>

            <FixSection fixes={fixes} section="prometheus-monitor-fix" />

            <CommandsSection commands={commandsFor(row)} section="prometheus-monitor-commands" />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
