import { observer } from "mobx-react";
import { type CoverageFilter, coverageLoadState } from "../api/coverage/coverage";
import { attentionOf, cardsOf, describeHeadline, type RowParams } from "../api/overview/attention";
import { describeLoadState, worstOf } from "../api/shared/store-state";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { OpenTelemetryStyles } from "../components/styles";
import { useInventory } from "../hooks/use-inventory";

export type OpenPage = (
  page: "coverage" | "collectors",
  params?: RowParams & { filter?: CoverageFilter },
) => void;

export const OverviewPage = observer(({ open }: { open: OpenPage }) => {
  const { stores, coverage, collectors } = useInventory({ collectors: true, coverage: true });
  const items = attentionOf(coverage, collectors);
  const state = worstOf(coverageLoadState(stores.coverageState, coverage), stores.collectorState);
  const loading = describeLoadState(state);

  return (
    <div className="OpenTelemetry OpenTelemetry-page">
      <OpenTelemetryStyles />
      <div className="OpenTelemetry-page__head">
        <div>
          <h1 className="OpenTelemetry-page__headline">{describeHeadline(coverage, collectors)}</h1>
          {loading ? (
            <p
              className={`OpenTelemetry-page__subline${state === "unreachable" ? " OpenTelemetry-page__subline--alarm" : ""}`}
            >
              {loading}
            </p>
          ) : (
            <p className="OpenTelemetry-page__subline">
              Whether each workload that opts in to auto-instrumentation got the agent, and whether
              each collector runs.
            </p>
          )}
        </div>
        <div className="OpenTelemetry-page__actions">
          <NamespaceFilter />
        </div>
      </div>

      <div className="OpenTelemetry-cards" data-section="opentelemetry-cards">
        {cardsOf(coverage, collectors, stores.collectorState === "ready").map((card) => (
          <StatCard
            key={card.label}
            value={card.value}
            label={card.label}
            tone={card.tone}
            title={card.title}
            onOpen={() =>
              card.opens.page === "coverage"
                ? open("coverage", { filter: card.opens.filter })
                : open("collectors")
            }
          />
        ))}
      </div>

      <section className="OpenTelemetry-section" data-section="opentelemetry-attention">
        <div className="OpenTelemetry-section__bar">
          <h2 className="OpenTelemetry-section__title">Needs attention</h2>
        </div>
        {items.length === 0 ? (
          <p className="OpenTelemetry-section__note">
            {state === "ready"
              ? "Nothing. Every opted-in workload has the agent and every collector is ready."
              : "—"}
          </p>
        ) : (
          <div className="OpenTelemetry-list">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`OpenTelemetry-row OpenTelemetry-row--${item.verdict.tone}`}
                title={`Opens ${item.name} in the ${item.page === "coverage" ? "Coverage" : "Collectors"} list`}
                onClick={(event) => {
                  // Unprevented, the drawer this opens takes the click as outside and closes.
                  event.preventDefault();
                  open(item.page, item.opens);
                }}
              >
                <span className="OpenTelemetry-row__state">{item.verdict.label}</span>
                <span className="OpenTelemetry-row__main">
                  <span className="OpenTelemetry-row__name">
                    <b>{item.name}</b>
                    <span className="OpenTelemetry-row__meta">{item.meta}</span>
                  </span>
                  <span className="OpenTelemetry-row__reason">{item.verdict.reason}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
