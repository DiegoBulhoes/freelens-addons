import { observer } from "mobx-react";

import { attentionItems, countsOf, describeHeadline } from "../api/rows";
import { describeLoadState } from "../api/store-state";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { MongoDBStyles } from "../components/styles";
import { useInventory } from "../hooks/use-inventory";

export const OverviewPage = observer(
  ({ openReplicaSets }: { openReplicaSets: (name?: string) => void }) => {
    const { stores, rows, agentError } = useInventory();
    const items = attentionItems(rows);
    const counts = countsOf(rows);
    const needing = new Set(items.map((item) => `${item.namespace}/${item.replicaSet}`)).size;
    const loading = describeLoadState(stores.state);

    return (
      <div className="MongoDB MongoDB-page">
        <MongoDBStyles />
        <div className="MongoDB-page__head">
          <div>
            <h1 className="MongoDB-page__headline">
              {describeHeadline(needing, counts.replicaSets)}
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

        {agentError && (
          <div className="MongoDB-banner">
            <div className="MongoDB-banner__title">Members' roles are unknown</div>
            <div className="MongoDB-banner__body">
              They come from each member's agent, which could not be read: {agentError}.
            </div>
          </div>
        )}

        <div className="MongoDB-cards" data-section="mongodb-cards">
          <StatCard value={counts.replicaSets} label="Clusters" onOpen={() => openReplicaSets()} />
          <StatCard
            value={counts.down}
            label="Down or failed"
            tone="critical"
            onOpen={() => openReplicaSets()}
          />
          <StatCard
            value={counts.degraded}
            label="Degraded"
            tone="warning"
            onOpen={() => openReplicaSets("degraded")}
          />
          <StatCard
            value={counts.changingVersion}
            label="Changing version"
            tone="info"
            onOpen={() => openReplicaSets()}
          />
          <StatCard
            value={counts.usersWithoutPassword}
            label="Users without a password"
            tone="critical"
            onOpen={() => openReplicaSets()}
          />
        </div>

        <section className="MongoDB-section" data-section="mongodb-attention">
          <div className="MongoDB-section__bar">
            <h2 className="MongoDB-section__title">Needs attention</h2>
          </div>
          {items.length === 0 ? (
            <p className="MongoDB-section__note">
              {stores.state === "ready" ? "Nothing. Every cluster is healthy." : "—"}
            </p>
          ) : (
            <div className="MongoDB-list">
              {items.map((item) => (
                <button
                  key={`${item.kind}/${item.namespace}/${item.replicaSet}/${item.name}`}
                  type="button"
                  className={`MongoDB-row MongoDB-row--${item.verdict.tone}`}
                  title={`Opens ${item.replicaSet} in the clusters list`}
                  onClick={() => openReplicaSets(item.replicaSet)}
                >
                  <span className="MongoDB-row__state">{item.verdict.label}</span>
                  <span className="MongoDB-row__main">
                    <span className="MongoDB-row__name">
                      <b>{item.name}</b>
                      <span className="MongoDB-row__meta">
                        {item.kind} · {item.namespace}
                        {item.kind === "User" && ` · ${item.replicaSet}`}
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
