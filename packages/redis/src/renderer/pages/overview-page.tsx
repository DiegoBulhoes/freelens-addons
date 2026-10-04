import { observer } from "mobx-react";

import { countsOf, describeHeadline, type RedisRow } from "../api/rows";
import { describeLoadState } from "../api/store-state";
import type { RedisKind } from "../api/types";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { RedisStyles } from "../components/styles";
import { useInventory } from "../hooks/use-inventory";

export const OverviewPage = observer(
  ({ open }: { open: (kind: RedisKind, name?: string) => void }) => {
    const { stores, rows } = useInventory();
    const needing = rows.filter((row) => row.health.tone !== "ok");
    const counts = countsOf(rows);
    const loading = describeLoadState(stores.state);
    const unwatched = rows.filter(
      (row: RedisRow) => row.kind === "Replication" && row.related.length === 0,
    );

    return (
      <div className="Redis Redis-page">
        <RedisStyles />
        <div className="Redis-page__head">
          <div>
            <h1 className="Redis-page__headline">
              {describeHeadline(needing.length, counts.total)}
            </h1>
            {loading ? (
              <p
                className={`Redis-page__subline${stores.state === "unreachable" ? " Redis-page__subline--alarm" : ""}`}
              >
                {loading}
              </p>
            ) : (
              <p className="Redis-page__subline">
                Whether each Redis has its pods up and a master, and what fails it over.
              </p>
            )}
          </div>
          <div className="Redis-page__actions">
            <NamespaceFilter />
          </div>
        </div>

        <div className="Redis-cards" data-section="redis-cards">
          <StatCard
            value={counts.replications}
            label="Replications"
            onOpen={() => open("Replication")}
          />
          <StatCard value={counts.clusters} label="Clusters" onOpen={() => open("Cluster")} />
          <StatCard
            value={counts.standalones}
            label="Standalones"
            onOpen={() => open("Standalone")}
          />
          <StatCard value={counts.sentinels} label="Sentinels" onOpen={() => open("Sentinel")} />
          <StatCard value={counts.down} label="Down or failed" tone="critical" />
          <StatCard value={counts.degraded} label="Degraded" tone="warning" />
          <StatCard
            value={counts.unwatched}
            label="Replications no sentinel watches"
            tone="info"
            onOpen={() => open("Replication")}
          />
        </div>

        <section className="Redis-section" data-section="redis-attention">
          <div className="Redis-section__bar">
            <h2 className="Redis-section__title">Needs attention</h2>
          </div>
          {needing.length === 0 ? (
            <p className="Redis-section__note">
              {stores.state === "ready" ? "Nothing. Every Redis is healthy." : "—"}
            </p>
          ) : (
            <div className="Redis-list">
              {needing.map((row) => (
                <button
                  key={`${row.kind}/${row.object.getNs()}/${row.object.getName()}`}
                  type="button"
                  className={`Redis-row Redis-row--${row.health.tone}`}
                  title={`Opens ${row.object.getName()} in its list`}
                  onClick={() => open(row.kind, row.object.getName())}
                >
                  <span className="Redis-row__state">{row.health.label}</span>
                  <span className="Redis-row__main">
                    <span className="Redis-row__name">
                      <b>{row.object.getName()}</b>
                      <span className="Redis-row__meta">
                        {row.kind} · {row.object.getNs()}
                      </span>
                    </span>
                    <span className="Redis-row__reason">{row.health.reason}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {unwatched.length > 0 && (
            <p className="Redis-hint">
              No sentinel watches {unwatched.map((row) => row.object.getName()).join(", ")}: if its
              master goes, nothing promotes a replica.
            </p>
          )}
        </section>
      </div>
    );
  },
);
