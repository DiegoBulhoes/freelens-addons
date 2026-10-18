import { observer } from "mobx-react";
import { primaryLabel, primaryOf, readyCount } from "../api/clusters/members";
import { keyOf, runningVersion, versionLabel, versionOrder } from "../api/clusters/replica-sets";
import { countsOf, type ReplicaSetRow } from "../api/clusters/rows";
import {
  matchesReplicaSetFilter,
  REPLICA_SET_FILTER_LABELS,
  REPLICA_SET_FILTER_TITLES,
  REPLICA_SET_FILTERS,
} from "../api/shared/navigation";
import { describeLoadState, emptyText } from "../api/shared/store-state";
import { deleteReplicaSet, patchReplicaSet } from "../api/writes/actions";
import { rollingRestartPatch, rollingRestartRefusal } from "../api/writes/operations";
import { AgentBanner } from "../components/agent-banner";
import { bulkAction } from "../components/bulk";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { useInventory } from "../hooks/use-inventory";
import { useNamedRow, useRequestedFilter } from "../hooks/use-list-params";
import { ReplicaSetDrawer } from "../replica-sets/replica-set-drawer";

/** See LIST_PARAMS in index.tsx. */
export interface ReplicaSetsPageParams {
  namespace?: { get(): string };
  name?: { get(): string };
  filter?: { get(): string };
}

const rowKey = (row: ReplicaSetRow) => keyOf(row.rs);

const COLUMNS: Column<ReplicaSetRow>[] = [
  {
    title: "Cluster",
    className: "MongoDB-table__shrink",
    cell: (row) => (
      <>
        {row.rs.getName()}
        <span className="MongoDB-muted"> · {row.rs.getNs()}</span>
      </>
    ),
    sortValue: (row) => row.rs.getName(),
  },
  {
    title: "State",
    className: "MongoDB-table__fill",
    cell: (row) => (
      <span className="MongoDB-truncate" title={row.health.reason}>
        <Status tone={row.health.tone} label={row.health.label} />
        {row.health.tone !== "ok" && <span className="MongoDB-muted"> · {row.health.reason}</span>}
      </span>
    ),
    sortValue: (row) => row.health.label,
  },
  {
    title: "Members",
    className: "MongoDB-table__number",
    cell: (row) => {
      const { ready, wanted } = readyCount(row.rs, row.members);

      return `${ready}/${wanted}`;
    },
    sortValue: (row) => readyCount(row.rs, row.members).ready,
  },
  {
    title: "Primary",
    className: "MongoDB-table__shrink",
    cell: (row) => {
      const label = primaryLabel(row.members);

      return label === "unknown" ? (
        <span className="MongoDB-muted" title="Its members' agents could not be read">
          unknown
        </span>
      ) : (
        label
      );
    },
    sortValue: (row) => primaryOf(row.members)?.name,
  },
  {
    title: "TLS",
    className: "MongoDB-table__shrink",
    cell: (row) =>
      row.tls.enabled ? (
        <span title={row.tls.secret ? `Secret ${row.tls.secret}` : undefined}>
          On{row.tls.certManager && <span className="MongoDB-muted"> · cert-manager</span>}
        </span>
      ) : (
        <span className="MongoDB-muted">Off</span>
      ),
    sortValue: (row) => (row.tls.enabled ? (row.tls.certManager ? 2 : 1) : 0),
  },
  {
    title: "Version",
    className: "MongoDB-table__shrink",
    cell: (row) => versionLabel(row.rs),
    sortValue: (row) => versionOrder(row.rs),
  },
];

export const ReplicaSetsPage = observer(({ params }: { params?: ReplicaSetsPageParams }) => {
  const { stores, rows, agentError } = useInventory();
  const [selectedKey, setSelectedKey] = useNamedRow(params);
  const [filter, setFilter] = useRequestedFilter(params);
  const selected = rows.find((row) => rowKey(row) === selectedKey);
  const counts = countsOf(rows);

  return (
    <ListPage
      title="Clusters"
      subline={
        describeLoadState(stores.state) ??
        "Worst first. A cluster opens with its members, users and actions."
      }
      section="mongodb-clusters"
      rows={rows.filter((row) => matchesReplicaSetFilter(row, filter))}
      columns={COLUMNS}
      keyOf={rowKey}
      searchTexts={(row) => [
        row.rs.getName(),
        row.rs.getNs() ?? "",
        row.health.label,
        runningVersion(row.rs) ?? "",
      ]}
      onOpen={(row) => setSelectedKey(rowKey(row))}
      empty={
        rows.length === 0
          ? emptyText(stores.state, "No MongoDB clusters in the namespaces in scope.")
          : "No cluster matches that filter."
      }
      filters={
        <>
          <AgentBanner error={agentError} />
          <FilterChips
            filters={REPLICA_SET_FILTERS}
            labels={REPLICA_SET_FILTER_LABELS}
            titles={REPLICA_SET_FILTER_TITLES}
            counts={counts}
            current={filter}
            onChange={setFilter}
            section="mongodb-cluster-filters"
          />
        </>
      }
      selection={{
        hint: "Writes to each ticked cluster that can take it; the rest are listed as skipped.",
        actions: [
          bulkAction<ReplicaSetRow>({
            label: "Restart",
            done: "Restarted",
            kind: "cluster",
            tooltip: "Asks the operator for a rolling restart of each ticked cluster.",
            caution: true,
            nameOf: (row) => row.rs.getName(),
            refuse: (row) => rollingRestartRefusal(row.rs),
            detail:
              "Each StatefulSet restarts its members by index, whichever is primary. Restart all, in a drawer, keeps the primary for last.",
            run: (row) => patchReplicaSet(row.rs, rollingRestartPatch(Date.now())),
          }),
          bulkAction<ReplicaSetRow>({
            label: "Delete",
            done: "Deleted",
            kind: "cluster",
            tooltip: "Deletes each ticked cluster; their volumes are kept.",
            caution: true,
            nameOf: (row) => row.rs.getName(),
            detail: "The operator removes their StatefulSets and pods. Volumes stay.",
            run: (row) => deleteReplicaSet(row.rs),
          }),
        ],
      }}
    >
      <ReplicaSetDrawer
        row={selected}
        agentError={agentError}
        onClose={() => setSelectedKey(undefined)}
      />
    </ListPage>
  );
});
