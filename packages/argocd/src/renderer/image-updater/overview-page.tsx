import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import {
  countWatching,
  describeRulesHeadline,
  describeRulesState,
  needingAttention,
  rankRules,
  recentUpdates,
  restartRefusal,
  trackedImages,
} from "../api/image-updates";
import { NamespaceFilter } from "../components/namespace-filter";
import { ArgoCDStyles } from "../components/styles";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { StatCard } from "../overview/stat-card";
import { confirmCheckNow } from "./dialogs";
import { IMAGE_UPDATER_PAGES } from "./pages";
import { RuleDrawer } from "./rule-drawer";
import { ago, opening, StateNote } from "./shared";

const {
  Component: { WithTooltip },
} = Renderer;

export const ImageUpdaterOverviewPage = observer(
  ({ extension }: { extension: Renderer.LensExtension }) => {
    const { updaters, applications, state } = useImageUpdaterStores();
    const [selectedKey, setSelectedKey] = useState<string>();
    const now = Date.now();

    const ranked = rankRules(updaters, applications, now);
    const attention = needingAttention(ranked);
    const images = trackedImages(updaters, applications);
    const keyOf = (row: (typeof ranked)[number]) =>
      `${row.updater.getNs()}/${row.updater.getName()}`;
    const selected = ranked.find((row) => keyOf(row) === selectedKey);
    const ready = state === "ready" && updaters.length > 0;

    return (
      <div className="ArgoCD ArgoCD-page">
        <ArgoCDStyles />
        <div className="ArgoCD-page__head">
          <div>
            <h1 className="ArgoCD-page__headline">
              {describeRulesHeadline(state, attention.length, updaters.length)}
            </h1>
            <StateNote note={describeRulesState(state)} alarm={state === "unreachable"} />
            {ready && (
              <p className="ArgoCD-page__subline">
                The controller checks every 2 minutes unless its <code>interval</code> says
                otherwise.
              </p>
            )}
          </div>
          <div className="ArgoCD-page__actions">
            <NamespaceFilter />
            {ready && (
              <WithTooltip tooltip="Restarts the controller, which checks every rule as it starts. Asks first">
                <button
                  type="button"
                  className="ArgoCD-button"
                  onClick={() => confirmCheckNow(restartRefusal(ranked))}
                >
                  Check now
                </button>
              </WithTooltip>
            )}
          </div>
        </div>

        {ready && (
          <section className="ArgoCD-section">
            <div className="ArgoCD-cards">
              <StatCard
                label="Rules"
                value={updaters.length}
                onOpen={() => void extension.navigate(IMAGE_UPDATER_PAGES.rules)}
              />
              <StatCard
                label="Need attention"
                value={attention.length}
                tone="critical"
                onOpen={() => void extension.navigate(IMAGE_UPDATER_PAGES.rules)}
              />
              <StatCard
                label="Images watched"
                value={countWatching(images)}
                onOpen={() => void extension.navigate(IMAGE_UPDATER_PAGES.images)}
              />
              <StatCard
                label="Last updates"
                value={recentUpdates(updaters).length}
                onOpen={() => void extension.navigate(IMAGE_UPDATER_PAGES.updates)}
              />
            </div>
          </section>
        )}

        {attention.length > 0 && (
          <section className="ArgoCD-section" data-section="image-updater-attention">
            <h2 className="ArgoCD-section__title">Needs attention</h2>
            <div className="ArgoCD-list">
              {attention.map((row) => (
                <button
                  key={keyOf(row)}
                  type="button"
                  className={`ArgoCD-row ArgoCD-row--${row.health.tone}`}
                  title="Opens the rule"
                  onClick={opening(() => setSelectedKey(keyOf(row)))}
                >
                  <span className="ArgoCD-row__state">{row.health.label}</span>
                  <span className="ArgoCD-row__main">
                    <span className="ArgoCD-row__name">
                      <b>{row.updater.getName()}</b>
                      <span className="ArgoCD-row__meta">{row.updater.getNs()}</span>
                    </span>
                    <span className="ArgoCD-row__reason">{row.health.reason}</span>
                  </span>
                  <span className="ArgoCD-row__aside">
                    {ago(row.updater.status?.lastCheckedAt, now)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <RuleDrawer
          updater={selected?.updater}
          health={selected?.health}
          applications={applications}
          onClose={() => setSelectedKey(undefined)}
          onOpenApplication={(name) => {
            setSelectedKey(undefined);
            void extension.navigate("applications", { name });
          }}
        />
      </div>
    );
  },
);
