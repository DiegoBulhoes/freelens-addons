import { observer } from "mobx-react";
import { useState } from "react";

import { deleteReplicaSet, patchReplicaSet } from "../api/actions";
import { bulkRefusal } from "../api/bulk";
import { primaryOf, readyCount } from "../api/members";
import { rollingRestartPatch } from "../api/operations";
import { runningVersion, versionLabel } from "../api/replica-sets";
import { keyOf, type ReplicaSetRow } from "../api/rows";
import { describeLoadState } from "../api/store-state";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { useInventory } from "../hooks/use-inventory";
import { ReplicaSetDrawer } from "../replica-sets/replica-set-drawer";

export interface ReplicaSetsPageParams {
  name?: { get(): string };
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
    cell: (row) => primaryOf(row.members)?.name ?? "—",
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
    sortValue: (row) => {
      const [major = 0, minor = 0, patch = 0] = (runningVersion(row.rs) ?? "")
        .split(".")
        .map(Number);

      return major * 1_000_000 + minor * 1000 + patch;
    },
  },
];

export const ReplicaSetsPage = observer(({ params }: { params?: ReplicaSetsPageParams }) => {
  const { stores, rows, agentError } = useInventory();
  const [selectedKey, setSelectedKey] = useState<string>();
  const selected = rows.find((row) => rowKey(row) === selectedKey);

  return (
    <ListPage
      title="Clusters"
      subline={
        describeLoadState(stores.state) ??
        "Worst first. A cluster opens with its members, users and actions."
      }
      section="mongodb-clusters"
      rows={rows}
      columns={COLUMNS}
      keyOf={rowKey}
      searchTexts={(row) => [
        row.rs.getName(),
        row.rs.getNs() ?? "",
        row.health.label,
        runningVersion(row.rs) ?? "",
      ]}
      onOpen={(row) => setSelectedKey(rowKey(row))}
      empty="No MongoDB clusters in the namespaces in scope."
      initialQuery={params?.name?.get()}
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
            refuse: (row) => bulkRefusal("restart")(row.rs),
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
        events={stores.events}
        agentError={agentError}
        onClose={() => setSelectedKey(undefined)}
      />
    </ListPage>
  );
});
