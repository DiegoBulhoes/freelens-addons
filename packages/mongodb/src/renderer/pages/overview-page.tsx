import { observer } from "mobx-react";
import { attentionItems, countsOf, describeHeadline } from "../api/clusters/rows";
import { keepDrawerOpen } from "../api/shared/drawer-click";
import { cardsOf, destinationOf, type OpenReplicaSets } from "../api/shared/navigation";
import { describeLoadState, emptyText } from "../api/shared/store-state";
import { AgentBanner } from "../components/agent-banner";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { MongoDBStyles } from "../components/styles";
import { useInventory } from "../hooks/use-inventory";

export const OverviewPage = observer(
  ({ openReplicaSets }: { openReplicaSets: OpenReplicaSets }) => {
    const { stores, rows, agentError } = useInventory();
    const items = attentionItems(rows);
    const counts = countsOf(rows);
    const needing = new Set(items.map((item) => `${item.namespace}/${item.replicaSet}`)).size;
    const loading = describeLoadState(stores.state);
    const cards = cardsOf(counts, stores.state);

    return (
      <div className="MongoDB MongoDB-page">
        <MongoDBStyles />
        <div className="MongoDB-page__head">
          <div>
            <h1 className="MongoDB-page__headline">
              {describeHeadline(needing, counts.replicaSets, stores.state)}
            </h1>
            {loading ? (
              <p
                className={`MongoDB-page__subline${stores.state === "unreachable" ? " MongoDB-page__subline--alarm" : ""}`}
              >
                {loading}
              </p>
            ) : (
              <p className="MongoDB-page__subline">
                Whether each cluster has its members up, a primary, and the version it was asked
                for.
              </p>
            )}
          </div>
          <div className="MongoDB-page__actions">
            <NamespaceFilter />
          </div>
        </div>

        <AgentBanner error={agentError} />

        {cards.length > 0 && (
          <div className="MongoDB-cards" data-section="mongodb-cards">
            {cards.map((card) => (
              <StatCard
                key={card.label}
                value={card.value}
                label={card.label}
                tone={card.tone}
                title={card.title}
                onOpen={() => openReplicaSets(card.opens)}
              />
            ))}
          </div>
        )}

        <section className="MongoDB-section" data-section="mongodb-attention">
          <div className="MongoDB-section__bar">
            <h2 className="MongoDB-section__title">Needs attention</h2>
          </div>
          {items.length === 0 ? (
            <p className="MongoDB-section__note">
              {emptyText(stores.state, "Nothing. Every cluster is healthy.")}
            </p>
          ) : (
            <div className="MongoDB-list">
              {items.map((item) => (
                <button
                  key={`${item.kind}/${item.namespace}/${item.replicaSet}/${item.name}`}
                  type="button"
                  className={`MongoDB-row MongoDB-row--${item.verdict.tone}`}
                  title={`Opens ${item.replicaSet}`}
                  onClick={(event) =>
                    keepDrawerOpen(event, () => openReplicaSets(destinationOf(item)))
                  }
                >
                  <span className="MongoDB-row__state">{item.verdict.label}</span>
                  <span className="MongoDB-row__main">
                    <span className="MongoDB-row__name">
                      <b>{item.name}</b>
                      <span className="MongoDB-row__meta">
                        {item.kind} · {item.namespace}
                        {item.kind !== "Cluster" && ` · ${item.replicaSet}`}
                      </span>
                    </span>
                    <span className="MongoDB-row__reason">{item.verdict.reason}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  },
);
