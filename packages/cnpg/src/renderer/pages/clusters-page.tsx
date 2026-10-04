import { observer } from "mobx-react";
import { useState } from "react";
import { createBackup, patchCluster } from "../api/actions";
import { type ClusterRow, clusterRows } from "../api/attention";
import { ago } from "../api/backups";
import { type ClusterBulk, clusterRefusal } from "../api/bulk";
import { wantsCause } from "../api/causes";
import { postgresVersion, readyCount, replicaNames } from "../api/clusters";
import { backupNow, hibernationPatch, reloadPatch, restartPatch } from "../api/operations";
import { formatBytes, replicaLags, worstLag } from "../api/replication";
import { describeLoadState } from "../api/store-state";
import type { ClusterLike } from "../api/types";
import { ClusterDrawer } from "../clusters/cluster-drawer";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { Status } from "../components/status";
import { causeKey, useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useInstanceStatuses } from "../hooks/use-instance-statuses";

export interface ClustersPageParams {
  name?: { get(): string };
}

const keyOf = (row: ClusterRow) => `${row.cluster.getNs()}/${row.cluster.getName()}`;

export const ClustersPage = observer(({ params }: { params?: ClustersPageParams }) => {
  const stores = useCnpgStores();
  const [selectedKey, setSelectedKey] = useState<string>();
  const now = Date.now();
  const rows = clusterRows(stores, now);
  const statuses = useInstanceStatuses(
    rows.flatMap(({ cluster }) =>
      (cluster.status?.readyInstances ?? 0) > 1
        ? (cluster.status?.instanceNames ?? []).map((name) => `${cluster.getNs()}/${name}`)
        : [],
    ),
  );
  const lagOf = (row: ClusterRow) => {
    const ns = row.cluster.getNs();

    return worstLag(
      replicaLags(
        statuses[`${ns}/${row.cluster.status?.currentPrimary}`],
        Object.fromEntries(
          (row.cluster.status?.instanceNames ?? []).map((name) => [
            name,
            statuses[`${ns}/${name}`],
          ]),
        ),
      ),
    );
  };
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
      tooltip: `${label}: each ticked cluster that can take it.`,
      caution,
      nameOf: (row) => row.cluster.getName(),
      refuse: (row) => clusterRefusal(action)(row.cluster),
      detail,
      run: (row) => run(row.cluster),
    });
  const selected = rows.find((row) => keyOf(row) === selectedKey);
  const causes = useCauses(
    rows.filter((row) => wantsCause(row.backup.label)).map((row) => row.cluster),
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
        const [major = 0, minor = 0] = (postgresVersion(row.cluster) ?? "").split(".").map(Number);

        return major * 1000 + minor;
      },
    },
    {
      title: "Primary",
      className: "CNPG-table__shrink",
      cell: (row) => row.cluster.status?.currentPrimary ?? "—",
      sortValue: (row) => row.cluster.status?.currentPrimary,
    },
    {
      title: "Replicas",
      className: "CNPG-table__shrink",
      cell: (row) => replicaNames(row.cluster).join(", ") || "—",
      sortValue: (row) => replicaNames(row.cluster).length,
    },
    {
      title: "Lag",
      className: "CNPG-table__shrink",
      cell: (row) => {
        const lag = lagOf(row);

        return lag ? (
          <Status
            tone={lag.verdict.tone}
            label={formatBytes(lag.bytes ?? 0)}
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
      cell: (row) => <StateCell verdict={row.backup} cause={causes.get(causeKey(row.cluster))} />,
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
        describeLoadState(stores.state) ??
        "Worst first. A cluster opens with its instances, backups and actions."
      }
      section="cnpg-clusters"
      rows={rows}
      columns={columns}
      keyOf={keyOf}
      searchTexts={(row) => [
        row.cluster.getName(),
        row.cluster.getNs() ?? "",
        row.health.label,
        row.backup.label,
      ]}
      onOpen={(row) => setSelectedKey(keyOf(row))}
      empty="No Postgres clusters in the namespaces in scope."
      initialQuery={params?.name?.get()}
      selection={{
        hint: "Writes to each ticked cluster that can take it; the rest are listed as skipped.",
        actions: [
          bulk(
            "backup",
            "Back up",
            "Started backups for",
            async (cluster) => {
              const manifest = backupNow(cluster, Date.now());

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
        cause={selected ? causes.get(causeKey(selected.cluster)) : undefined}
        row={selected}
        inventory={stores}
        onClose={() => setSelectedKey(undefined)}
      />
    </ListPage>
  );
});
