import { observer } from "mobx-react";
import { failedBackupOf } from "../api/backups/causes";
import {
  attentionItems,
  attentionKey,
  cardsOf,
  clusterRows,
  clustersNeeding,
  countsOf,
  describeHeadline,
  destinationOf,
} from "../api/overview/attention";
import { instanceKeys } from "../api/replication/replication";
import type { OpenPage } from "../api/shared/navigation";
import { clusterNamed, indexInventory } from "../api/shared/rows";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { CNPGStyles } from "../components/styles";
import { useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useInstanceStatuses } from "../hooks/use-instance-statuses";

export const OverviewPage = observer(({ open }: { open: OpenPage }) => {
  const stores = useCnpgStores("overview");
  const now = Date.now();
  // Each primary's status says how far its replicas are; replicas add whether they are paused.
  const statuses = useInstanceStatuses(
    stores.clusters.flatMap((cluster) =>
      cluster.status?.currentPrimary && (cluster.status?.readyInstances ?? 0) > 1
        ? instanceKeys(cluster)
        : [],
    ),
  );
  const index = indexInventory(stores);
  const rows = clusterRows(stores, now, index);
  const items = attentionItems({ ...stores, statuses }, now, index, rows);
  const counts = countsOf(stores, now, rows);
  const causes = useCauses(
    items.map((item) => ({
      key: attentionKey(item),
      cluster: clusterNamed(stores.clusters, item.namespace, item.cluster),
      label: item.verdict.label,
      failed: failedBackupOf(item, index),
    })),
  );
  const cards = cardsOf(counts, stores.load.state);
  const { note: loading, alarm } = stores.load;

  return (
    <div className="CNPG CNPG-page">
      <CNPGStyles />
      <div className="CNPG-page__head">
        <div>
          <h1 className="CNPG-page__headline">
            {describeHeadline(clustersNeeding(items), counts.clusters, stores.load.state)}
          </h1>
          {loading ? (
            <p className={`CNPG-page__subline${alarm ? " CNPG-page__subline--alarm" : ""}`}>
              {loading}
            </p>
          ) : (
            <p className="CNPG-page__subline">
              Whether each Postgres cluster is up, and whether it can be restored from its backups.
            </p>
          )}
        </div>
        <div className="CNPG-page__actions">
          <NamespaceFilter />
        </div>
      </div>

      {cards.length > 0 && (
        <div className="CNPG-cards" data-section="cnpg-cards">
          {cards.map((card) => (
            <StatCard
              key={card.label}
              value={card.value}
              label={card.label}
              tone={card.tone}
              title={card.title}
              onOpen={() => open(...card.opens)}
            />
          ))}
        </div>
      )}

      <section className="CNPG-section" data-section="cnpg-attention">
        <div className="CNPG-section__bar">
          <h2 className="CNPG-section__title">Needs attention</h2>
        </div>
        {items.length === 0 ? (
          <p className="CNPG-section__note">
            {loading ? "—" : "Nothing. Every cluster is up and backed up."}
          </p>
        ) : (
          <div className="CNPG-list">
            {items.map((item) => (
              <button
                key={attentionKey(item)}
                type="button"
                className={`CNPG-row CNPG-row--${item.verdict.tone}`}
                title={destinationOf(item).title}
                onClick={() => open(...destinationOf(item).opens)}
              >
                <span className="CNPG-row__state">{item.verdict.label}</span>
                <span className="CNPG-row__main">
                  <span className="CNPG-row__name">
                    <b>{item.name}</b>
                    <span className="CNPG-row__meta">
                      {item.kind} · {item.namespace}
                      {item.kind !== "Cluster" && ` · ${item.cluster}`}
                    </span>
                  </span>
                  <span className="CNPG-row__reason">
                    {item.verdict.reason}
                    {causes.get(attentionKey(item)) && (
                      <span className="CNPG-text--critical">
                        {" "}
                        Cause: {causes.get(attentionKey(item))}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
