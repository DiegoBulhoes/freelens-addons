import { observer } from "mobx-react";
import { backupManifest } from "../api/backups/backup-manifests";
import { failedBackupOf } from "../api/backups/causes";
import { postgresVersion, readyCount, replicaSourceOf } from "../api/clusters/clusters";
import { serverTlsSource, tlsSecretsOf } from "../api/clusters/connection";
import { secretsIn } from "../api/clusters/secret-metadata";
import { type ClusterRow, clusterRows } from "../api/overview/attention";
import { clusterLags, formatBytes, instanceKeys, worstLag } from "../api/replication/replication";
import { bulkEffect } from "../api/shared/effects";
import {
  CLUSTER_FILTER_LABELS,
  CLUSTER_FILTER_TITLES,
  CLUSTER_FILTERS,
  type ClusterFilter,
  isClusterFilter,
  keyOf,
  matchesClusterFilter,
  type OpenPage,
} from "../api/shared/navigation";
import { indexInventory } from "../api/shared/rows";
import { clusterSearchTexts } from "../api/shared/search";
import { emptyText } from "../api/shared/store-state";
import type { ClusterLike } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { createBackup, patchCluster } from "../api/writes/actions";
import { type ClusterBulk, clusterRefusal } from "../api/writes/bulk";
import { hibernationPatch, reloadPatch, restartPatch } from "../api/writes/operations";
import { ClusterDrawer } from "../clusters/cluster-drawer";
import { bulkAction } from "../components/bulk";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { Status } from "../components/status";
import { useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useInstanceStatuses } from "../hooks/use-instance-statuses";
import { useNamedRow, useRequestedFilter } from "../hooks/use-list-params";
import { useSecretNames } from "../hooks/use-secret-names";
import type { ListParams } from "./list-params";

export const ClustersPage = observer(
  ({ params, open }: { params?: ListParams; open: OpenPage }) => {
    const stores = useCnpgStores("clusters");
    const [selectedKey, setSelectedKey] = useNamedRow(params);
    const [filter, setFilter] = useRequestedFilter(params, isClusterFilter);
    const now = Date.now();
    const index = indexInventory(stores);
    const rows = clusterRows(stores, now, index);
    const counts = Object.fromEntries(
      CLUSTER_FILTERS.map((each) => [
        each,
        rows.filter((row) => matchesClusterFilter(row, each)).length,
      ]),
    ) as Record<ClusterFilter, number>;
    const statuses = useInstanceStatuses(
      rows.flatMap(({ cluster }) =>
        (cluster.status?.readyInstances ?? 0) > 1 ? instanceKeys(cluster) : [],
      ),
    );
    const lagOf = (row: ClusterRow) => worstLag(clusterLags(row.cluster, statuses));
    const bulk = (
      action: ClusterBulk,
      label: string,
      done: string,
      run: (cluster: ClusterLike) => Promise<void>,
      caution = false,
      detail?: string,
    ) =>
      bulkAction<ClusterRow>({
        label,
        done,
        kind: "cluster",
        tooltip: bulkEffect(action),
        caution,
        nameOf: (row) => row.cluster.getName(),
        refuse: (row) => clusterRefusal(action)(row.cluster),
        detail,
        run: (row) => run(row.cluster),
      });
    const selected = rows.find((row) => keyOf(row.cluster) === selectedKey);
    const secrets = useSecretNames(
      [...new Set(stores.clusters.map((cluster) => cluster.getNs() ?? ""))].sort(),
    );
    const tlsOf = (row: ClusterRow) =>
      serverTlsSource(tlsSecretsOf(row.cluster, secretsIn(secrets, row.cluster.getNs())));
    const causes = useCauses(
      rows.map((row) => ({
        key: keyOf(row.cluster),
        cluster: row.cluster,
        label: row.backup.label,
        failed: failedBackupOf(
          {
            kind: "Cluster",
            namespace: row.cluster.getNs(),
            name: row.cluster.getName(),
            cluster: row.cluster.getName(),
          },
          index,
        ),
      })),
    );

    const columns: Column<ClusterRow>[] = [
      {
        title: "Cluster",
        className: "CNPG-table__shrink",
        cell: (row) => (
          <>
            {row.cluster.getName()}
            <span className="CNPG-muted"> · {row.cluster.getNs()}</span>
          </>
        ),
        sortValue: (row) => row.cluster.getName(),
      },
      {
        title: "State",
        cell: (row) => (
          <Status tone={row.health.tone} label={row.health.label} title={row.health.reason} />
        ),
        sortValue: (row) => row.health.label,
      },
      {
        title: "Instances",
        className: "CNPG-table__number",
        cell: (row) => {
          const { ready, wanted } = readyCount(row.cluster);

          return `${ready}/${wanted}`;
        },
        sortValue: (row) => readyCount(row.cluster).ready,
      },
      {
        title: "Postgres",
        className: "CNPG-table__shrink",
        cell: (row) => postgresVersion(row.cluster) ?? "—",
        sortValue: (row) => {
          const [major = 0, minor = 0] = (postgresVersion(row.cluster) ?? "")
            .split(".")
            .map(Number);

          return major * 1000 + minor;
        },
      },
      {
        title: "Primary",
        className: "CNPG-table__shrink",
        cell: (row) => {
          const source = replicaSourceOf(row.cluster);

          return (
            <>
              {row.cluster.status?.currentPrimary ?? "—"}
              {source && <span className="CNPG-muted"> · replica of {source.name}</span>}
            </>
          );
        },
        sortValue: (row) => row.cluster.status?.currentPrimary,
      },
      {
        title: "TLS",
        className: "CNPG-table__shrink",
        cell: (row) => <span className="CNPG-muted">{tlsOf(row)}</span>,
        sortValue: (row) => tlsOf(row),
      },
      {
        title: "Lag",
        className: "CNPG-table__shrink",
        cell: (row) => {
          const lag = lagOf(row);

          return lag ? (
            <Status
              tone={lag.verdict.tone}
              label={lag.bytes === undefined ? lag.verdict.label : formatBytes(lag.bytes)}
              title={`${lag.replica}: ${lag.verdict.label}. ${lag.verdict.reason}`}
            />
          ) : (
            "—"
          );
        },
        sortValue: (row) => lagOf(row)?.bytes,
      },
      {
        title: "Backups",
        className: "CNPG-table__fill",
        cell: (row) => <StateCell verdict={row.backup} cause={causes.get(keyOf(row.cluster))} />,
        sortValue: (row) => row.backup.label,
      },
      {
        title: "Last backup",
        className: "CNPG-table__shrink",
        cell: (row) => <span className="CNPG-muted">{ago(row.lastBackup, now)}</span>,
        sortValue: (row) => (row.lastBackup ? Date.parse(row.lastBackup) : undefined),
      },
    ];

    return (
      <ListPage
        title="Postgres clusters"
        subline={
          stores.load.note ??
          "Worst first. A cluster opens with its instances, backups and actions."
        }
        alarm={stores.load.alarm}
        section="cnpg-clusters"
        rows={rows.filter((row) => matchesClusterFilter(row, filter))}
        columns={columns}
        keyOf={(row) => keyOf(row.cluster)}
        searchTexts={clusterSearchTexts}
        onOpen={(row) => setSelectedKey(keyOf(row.cluster))}
        empty={emptyText(
          stores.load,
          rows.length === 0
            ? "No Postgres clusters in the namespaces in scope."
            : "No cluster matches that filter.",
        )}
        filters={
          <FilterChips
            filters={CLUSTER_FILTERS}
            labels={CLUSTER_FILTER_LABELS}
            titles={CLUSTER_FILTER_TITLES}
            counts={counts}
            current={filter}
            onChange={setFilter}
            section="cnpg-cluster-filters"
          />
        }
        selection={{
          hint: "Writes to each ticked cluster that can take it; the rest are listed as skipped.",
          actions: [
            bulk(
              "backup",
              "Back up",
              "Started backups for",
              async (cluster) => {
                const manifest = backupManifest(cluster, Date.now());

                if (manifest) await createBackup(manifest);
              },
              false,
            ),
            bulk(
              "reload",
              "Reload",
              "Reloaded",
              (cluster) => patchCluster(cluster, reloadPatch(Date.now())),
              false,
            ),
            bulk(
              "wake",
              "Wake",
              "Woke",
              (cluster) => patchCluster(cluster, hibernationPatch(false)),
              false,
            ),
            bulk(
              "hibernate",
              "Hibernate",
              "Hibernated",
              (cluster) => patchCluster(cluster, hibernationPatch(true)),
              true,
              "Postgres stops and the pods are deleted; the volumes are kept.",
            ),
            bulk(
              "restart",
              "Restart",
              "Restarted",
              (cluster) => patchCluster(cluster, restartPatch(Date.now())),
              true,
              "Each restarts its instances one at a time, then switches over.",
            ),
          ],
        }}
      >
        <ClusterDrawer
          secrets={secrets}
          cause={selected ? causes.get(keyOf(selected.cluster)) : undefined}
          row={selected}
          inventory={stores}
          onClose={() => setSelectedKey(undefined)}
          open={open}
        />
      </ListPage>
    );
  },
);
