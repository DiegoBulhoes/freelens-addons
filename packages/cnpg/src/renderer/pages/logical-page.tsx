import { observer } from "mobx-react";
import { type LogicalRow, logicalRows } from "../api/replication/logical";
import type { OpenPage } from "../api/shared/navigation";
import { logicalSearchTexts } from "../api/shared/search";
import { emptyText } from "../api/shared/store-state";
import { deleteLogical } from "../api/writes/actions";
import { bulkAction } from "../components/bulk";
import { CellLink } from "../components/drawer-link";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useNamedRow } from "../hooks/use-list-params";
import { LogicalDrawer } from "./drawers";
import type { ListParams } from "./list-params";
import { logicalActions, RowMenu } from "./row-dialogs";

const logicalKey = (row: LogicalRow) => `${row.kind}/${row.object.getNs()}/${row.object.getName()}`;

export const LogicalPage = observer(({ params, open }: { params?: ListParams; open: OpenPage }) => {
  const stores = useCnpgStores("logical");
  const [selectedKey, setSelectedKey] = useNamedRow(params, true);
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
        <CellLink
          title="Opens the cluster"
          onClick={() => open("clusters", { namespace: row.object.getNs(), name: row.cluster })}
        >
          {row.cluster}
        </CellLink>
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
      subline={
        stores.load.note ??
        "Publications and subscriptions the operator manages, and whether each was applied in Postgres."
      }
      alarm={stores.load.alarm}
      section="cnpg-logical"
      rows={rows}
      columns={columns}
      keyOf={logicalKey}
      searchTexts={logicalSearchTexts}
      onOpen={(row) => setSelectedKey(logicalKey(row))}
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
      menu={(row) => <RowMenu actions={logicalActions(row)} />}
      empty={emptyText(stores.load, "No Publications or Subscriptions in the namespaces in scope.")}
    >
      <LogicalDrawer
        row={rows.find((row) => logicalKey(row) === selectedKey)}
        onClose={() => setSelectedKey(undefined)}
        open={open}
      />
    </ListPage>
  );
});
