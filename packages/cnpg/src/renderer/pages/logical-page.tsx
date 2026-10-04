import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import { deleteLogical } from "../api/actions";
import { type LogicalRow, logicalRows } from "../api/logical";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { LogicalDrawer } from "./drawers";
import { confirmDeleteLogical } from "./row-dialogs";

const {
  Component: { Icon, MenuItem },
} = Renderer;

const keyOf = (row: LogicalRow) => `${row.kind}/${row.object.getNs()}/${row.object.getName()}`;

export const LogicalPage = observer(
  ({ onOpenCluster }: { onOpenCluster: (name: string) => void }) => {
    const stores = useCnpgStores();
    const [selectedKey, setSelectedKey] = useState<string>();
    const rows = logicalRows(stores.publications ?? [], stores.subscriptions ?? []);

    const columns: Column<LogicalRow>[] = [
      {
        title: "Name",
        className: "CNPG-table__shrink",
        cell: (row) => (
          <>
            {row.object.getName()}
            <span className="CNPG-muted"> · {row.object.getNs()}</span>
          </>
        ),
        sortValue: (row) => row.object.getName(),
      },
      {
        title: "Kind",
        className: "CNPG-table__shrink",
        cell: (row) => row.kind,
        sortValue: (row) => row.kind,
      },
      {
        title: "State",
        className: "CNPG-table__fill",
        cell: (row) => <StateCell verdict={row.verdict} />,
        sortValue: (row) => row.verdict.label,
      },
      {
        title: "Cluster",
        className: "CNPG-table__shrink",
        cell: (row) => (
          <button
            type="button"
            className="CNPG-link"
            title="Opens the cluster"
            onClick={(event) => {
              event.preventDefault();
              // The row opens a drawer; this link goes to the cluster instead.
              event.stopPropagation();
              onOpenCluster(row.cluster);
            }}
          >
            {row.cluster}
          </button>
        ),
        sortValue: (row) => row.cluster,
      },
      {
        title: "Database",
        className: "CNPG-table__shrink",
        cell: (row) => row.database,
        sortValue: (row) => row.database,
      },
      {
        title: "In Postgres",
        className: "CNPG-table__shrink",
        cell: (row) => <span className="CNPG-mono">{row.name}</span>,
        sortValue: (row) => row.name,
      },
      {
        title: "Carries",
        className: "CNPG-table__shrink",
        cell: (row) => row.peer,
        sortValue: (row) => row.peer,
      },
    ];

    return (
      <ListPage
        title="Logical replication"
        subline="Publications and subscriptions the operator manages, and whether each was applied in Postgres."
        section="cnpg-logical"
        rows={rows}
        columns={columns}
        keyOf={keyOf}
        searchTexts={(row) => [
          row.object.getName(),
          row.kind,
          row.cluster,
          row.database,
          row.name,
          row.verdict.label,
        ]}
        onOpen={(row) => setSelectedKey(keyOf(row))}
        selection={{
          hint: "Deletes the objects; Postgres keeps each unless its reclaim policy is delete.",
          actions: [
            bulkAction<LogicalRow>({
              label: "Delete",
              done: "Deleted",
              kind: "object",
              tooltip: "Deletes the ticked publications and subscriptions.",
              caution: true,
              nameOf: (row) => row.object.getName(),
              detail: "Postgres keeps each one whose reclaim policy is retain, the default.",
              run: (row) => deleteLogical(row.object, row.kind),
            }),
          ],
        }}
        menu={(row) => (
          <MenuItem onClick={() => confirmDeleteLogical(row)}>
            <Icon
              material="delete"
              tooltip="Deletes the object; Postgres keeps it unless its reclaim policy is delete. Asks you to type its name"
            />
            <span className="title">Delete</span>
          </MenuItem>
        )}
        empty="No Publications or Subscriptions in the namespaces in scope."
      >
        <LogicalDrawer
          row={rows.find((row) => keyOf(row) === selectedKey)}
          onClose={() => setSelectedKey(undefined)}
          onOpenCluster={(name) => {
            setSelectedKey(undefined);
            onOpenCluster(name);
          }}
        />
      </ListPage>
    );
  },
);
