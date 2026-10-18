import { observer } from "mobx-react";
import { useRef, useState } from "react";
import {
  attentionOf,
  countsOf,
  describeHeadline,
  keyOf,
  matchesFilter,
  needsAttention,
  type RowFilter,
} from "../api/objects/rows";
import { keepDrawerOpen } from "../api/shared/drawer-click";
import type { OpenPage } from "../api/shared/navigation";
import { emptyText, pageNote } from "../api/shared/store-state";
import { NamespaceFilter } from "../components/namespace-filter";
import { RowFilters } from "../components/row-filters";
import { StatCard } from "../components/stat-card";
import { RedisStyles } from "../components/styles";
import { useInventory } from "../hooks/use-inventory";

const ATTENTION_FILTERS: RowFilter[] = ["all", "down", "degraded"];

export const OverviewPage = observer(({ open }: { open: OpenPage }) => {
  const { stores, rows } = useInventory();
  const [filter, setFilter] = useState<RowFilter>("all");
  const attention = useRef<HTMLElement>(null);
  const needing = rows.filter(needsAttention);
  const shown = attentionOf(rows, filter);
  // Down and degraded span every kind: their cards narrow Needs attention, not one kind's list.
  const narrow = (to: RowFilter) => {
    setFilter(to);
    attention.current?.scrollIntoView({ block: "start" });
  };
  const counts = countsOf(rows);
  const { note, alarm } = pageNote(stores.state, stores.failures);
  const unwatched = rows.filter((row) => matchesFilter(row, "unwatched"));

  return (
    <div className="Redis Redis-page">
      <RedisStyles />
      <div className="Redis-page__head">
        <div>
          <h1 className="Redis-page__headline">{describeHeadline(rows, stores.state)}</h1>
          {note ? (
            <p className={`Redis-page__subline${alarm ? " Redis-page__subline--alarm" : ""}`}>
              {note}
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

      {stores.state === "ready" && (
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
          <StatCard
            value={counts.down}
            label="Down or failed"
            tone="critical"
            title="Shows only those under Needs attention"
            onOpen={() => narrow("down")}
          />
          <StatCard
            value={counts.degraded}
            label="Degraded"
            tone="warning"
            title="Shows only those under Needs attention"
            onOpen={() => narrow("degraded")}
          />
          <StatCard
            value={counts.unwatched}
            label="Replications no sentinel watches"
            tone="info"
            title="Opens the Replications list on those no sentinel watches"
            onOpen={() => open("Replication", { filter: "unwatched" })}
          />
        </div>
      )}

      <section className="Redis-section" data-section="redis-attention" ref={attention}>
        <div className="Redis-section__bar">
          <h2 className="Redis-section__title">Needs attention</h2>
          {needing.length > 0 && (
            <RowFilters filters={ATTENTION_FILTERS} current={filter} onChange={setFilter} />
          )}
        </div>
        {shown.length === 0 ? (
          <p className="Redis-section__note">
            {needing.length > 0
              ? "None of those."
              : emptyText(stores.state, "Nothing. Every Redis is healthy.")}
          </p>
        ) : (
          <div className="Redis-list">
            {shown.map((row) => (
              <button
                key={keyOf(row.object)}
                type="button"
                className={`Redis-row Redis-row--${row.health.tone}`}
                title={`Opens ${row.object.getName()}'s drawer`}
                onClick={(event) =>
                  keepDrawerOpen(event, () =>
                    open(row.kind, { namespace: row.object.getNs(), name: row.object.getName() }),
                  )
                }
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
});
