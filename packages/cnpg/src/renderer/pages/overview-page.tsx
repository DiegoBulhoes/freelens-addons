import { observer } from "mobx-react";

import { type AttentionItem, attentionItems, countsOf, describeHeadline } from "../api/attention";
import { wantsCause } from "../api/causes";
import { describeLoadState } from "../api/store-state";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { CNPGStyles } from "../components/styles";
import { causeKey, useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useInstanceStatuses } from "../hooks/use-instance-statuses";

export interface OverviewNavigation {
  openClusters: (name?: string) => void;
  openPoolers: () => void;
  openSchedules: () => void;
  openLogical: () => void;
}

export const OverviewPage = observer(({ navigate }: { navigate: OverviewNavigation }) => {
  const stores = useCnpgStores();
  const now = Date.now();
  // Each primary's status says how far its replicas are; replicas add whether they are paused.
  const statuses = useInstanceStatuses(
    stores.clusters.flatMap((cluster) =>
      cluster.status?.currentPrimary && (cluster.status?.readyInstances ?? 0) > 1
        ? (cluster.status?.instanceNames ?? []).map((name) => `${cluster.getNs()}/${name}`)
        : [],
    ),
  );
  const items = attentionItems({ ...stores, statuses }, now);
  const counts = countsOf(stores, now);
  const clustersNeeding = new Set(
    items.filter((item) => item.kind === "Cluster").map((item) => item.name),
  ).size;
  const failing = new Set(
    items
      .filter((item) => item.kind !== "Pooler" && wantsCause(item.verdict.label))
      .map((item) => `${item.namespace}/${item.cluster}`),
  );
  const causes = useCauses(stores.clusters.filter((cluster) => failing.has(causeKey(cluster))));
  const destinationOf = (item: AttentionItem) =>
    item.kind === "Pooler"
      ? { title: "Opens the poolers", open: navigate.openPoolers }
      : item.kind === "ScheduledBackup"
        ? { title: "Opens the schedules", open: navigate.openSchedules }
        : item.kind === "Publication" || item.kind === "Subscription"
          ? { title: "Opens logical replication", open: navigate.openLogical }
          : { title: "Opens the cluster", open: () => navigate.openClusters(item.name) };
  const loading = describeLoadState(stores.state);

  return (
    <div className="CNPG CNPG-page">
      <CNPGStyles />
      <div className="CNPG-page__head">
        <div>
          <h1 className="CNPG-page__headline">
            {describeHeadline(clustersNeeding, counts.clusters)}
          </h1>
          {loading ? (
            <p
              className={`CNPG-page__subline${stores.state === "unreachable" ? " CNPG-page__subline--alarm" : ""}`}
            >
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

      <div className="CNPG-cards" data-section="cnpg-cards">
        <StatCard value={counts.clusters} label="Clusters" onOpen={() => navigate.openClusters()} />
        <StatCard
          value={counts.notReady}
          label="Not ready"
          tone="critical"
          onOpen={() => navigate.openClusters("not ready")}
        />
        <StatCard
          value={counts.backupsAtRisk}
          label="Cannot be restored safely"
          tone="critical"
          onOpen={() => navigate.openClusters()}
        />
        <StatCard
          value={counts.noBackup}
          label="No backup"
          tone="critical"
          onOpen={() => navigate.openClusters("no backup")}
        />
        <StatCard
          value={counts.hibernated}
          label="Hibernated"
          tone="info"
          onOpen={() => navigate.openClusters("hibernated")}
        />
        <StatCard
          value={counts.poolersDown}
          label="Poolers down"
          tone="critical"
          onOpen={navigate.openPoolers}
        />
      </div>

      <section className="CNPG-section" data-section="cnpg-attention">
        <div className="CNPG-section__bar">
          <h2 className="CNPG-section__title">Needs attention</h2>
        </div>
        {items.length === 0 ? (
          <p className="CNPG-section__note">
            {stores.state === "ready" ? "Nothing. Every cluster is up and backed up." : "—"}
          </p>
        ) : (
          <div className="CNPG-list">
            {items.map((item) => (
              <button
                key={`${item.kind}/${item.namespace}/${item.name}/${item.verdict.label}`}
                type="button"
                className={`CNPG-row CNPG-row--${item.verdict.tone}`}
                title={destinationOf(item).title}
                onClick={destinationOf(item).open}
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
                    {wantsCause(item.verdict.label) &&
                      causes.get(`${item.namespace}/${item.cluster}`) && (
                        <span className="CNPG-text--critical">
                          {" "}
                          Cause: {causes.get(`${item.namespace}/${item.cluster}`)}
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
