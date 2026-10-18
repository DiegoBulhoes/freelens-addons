import { observer } from "mobx-react";

import {
  attentionOf,
  type Card,
  cardsOf,
  describeHeadline,
  type OpenPage,
} from "../api/overview/attention";
import { linkTitle } from "../api/shared/facts";
import { describeRefusedEvents } from "../api/shared/rejections";
import { describeLoadState } from "../api/shared/store-state";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { PrometheusStyles } from "../components/styles";
import { useInventory } from "../hooks/use-inventory";

// Keep the page and headline class names: the e2e layout suite reads them.
export const OverviewPage = observer(({ open }: { open: OpenPage }) => {
  const { stores, monitors, rules, instances, eventsRefused, live } = useInventory({
    monitors: true,
    rules: true,
    alerting: true,
  });
  const items = attentionOf(monitors, rules, instances);
  const loading = describeLoadState(stores.state);
  const openCard = (card: Card) => open(card.opens.page, { filter: card.opens.filter });

  return (
    <div className="Prometheus Prometheus-page" data-live={live}>
      <PrometheusStyles />
      <div className="Prometheus-page__head">
        <div>
          <h1 className="Prometheus-page__headline">
            {describeHeadline(monitors, rules, instances)}
          </h1>
          {loading ? (
            <p
              className={`Prometheus-page__subline${stores.state === "unreachable" ? " Prometheus-page__subline--alarm" : ""}`}
            >
              {loading}
            </p>
          ) : (
            <p className="Prometheus-page__subline">
              Whether a Prometheus, an agent or a TargetAllocator selects each monitor and rule, and
              whether its targets answer. {describeRefusedEvents(eventsRefused)}
            </p>
          )}
        </div>
        <div className="Prometheus-page__actions">
          <NamespaceFilter />
        </div>
      </div>

      <div className="Prometheus-cards" data-section="prometheus-cards">
        {cardsOf(monitors, rules, instances).map((card) => (
          <StatCard
            key={card.label}
            value={card.value}
            label={card.label}
            tone={card.tone}
            title={card.title}
            onOpen={() => openCard(card)}
          />
        ))}
      </div>

      <section className="Prometheus-section" data-section="prometheus-attention">
        <div className="Prometheus-section__bar">
          <h2 className="Prometheus-section__title">Needs attention</h2>
        </div>
        {items.length === 0 ? (
          <p className="Prometheus-section__note">
            {stores.state === "ready"
              ? "Nothing. Every monitor and rule is selected and loaded, every target is up and every instance is available."
              : "—"}
          </p>
        ) : (
          <div className="Prometheus-list">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`Prometheus-row Prometheus-row--${item.verdict.tone}`}
                title={linkTitle({ page: item.page, ...item.opens, name: item.name })}
                onClick={(event) => {
                  // Unprevented, the drawer this opens takes the click as outside and closes.
                  event.preventDefault();
                  open(item.page, item.opens);
                }}
              >
                <span className="Prometheus-row__state">{item.verdict.label}</span>
                <span className="Prometheus-row__main">
                  <span className="Prometheus-row__name">
                    <b>{item.name}</b>
                    <span className="Prometheus-row__meta">{item.meta}</span>
                  </span>
                  <span className="Prometheus-row__reason">{item.verdict.reason}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
