import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { backupsNewestFirst, backupTime } from "../api/backups/backups";
import { clusterKeyOf, keyOf, namedKey, type OpenPage } from "../api/shared/navigation";
import { backupDuration, backupVerdict, clusterNamed } from "../api/shared/rows";
import { backupSearchTexts } from "../api/shared/search";
import { emptyText } from "../api/shared/store-state";
import type { BackupLike } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { deleteBackup } from "../api/writes/actions";
import { bulkAction } from "../components/bulk";
import { CellLink } from "../components/drawer-link";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useBackupCause } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useNamedRow } from "../hooks/use-list-params";
import { BackupDrawer } from "./drawers";
import type { ListParams } from "./list-params";
import { backupActions, confirmBackupPicker, RowMenu } from "./row-dialogs";

const {
  Component: { WithTooltip },
} = Renderer;

// Search and sort run over every Backup; only the DOM is capped.
const DRAWN = 200;

export const BackupsPage = observer(({ params, open }: { params?: ListParams; open: OpenPage }) => {
  const stores = useCnpgStores("backups");
  const [selectedKey, setSelectedKey] = useNamedRow(params);
  // A cluster drawer's "All N backups" narrows the list to that cluster.
  const requested = namedKey(params?.namespace?.get(), params?.cluster?.get());
  const [ofCluster, setOfCluster] = useState(requested);

  useEffect(() => {
    setOfCluster(requested);
  }, [requested]);
  const selected = stores.backups.find((backup) => keyOf(backup) === selectedKey);
  const failedCluster =
    selected?.status?.phase === "failed"
      ? clusterNamed(stores.clusters, selected.getNs(), selected.spec.cluster.name)
      : undefined;
  const cause = useBackupCause(failedCluster ? selected : undefined, failedCluster);
  const now = Date.now();
  const rows = backupsNewestFirst(
    stores.backups.filter((backup) => !ofCluster || clusterKeyOf(backup) === ofCluster),
  );

  const columns: Column<BackupLike>[] = [
    {
      title: "Backup",
      className: "CNPG-table__shrink",
      cell: (backup) => (
        <>
          {backup.getName()}
          <span className="CNPG-muted"> · {backup.getNs()}</span>
        </>
      ),
      sortValue: (backup) => backup.getName(),
    },
    {
      title: "State",
      className: "CNPG-table__fill",
      cell: (backup) => {
        const verdict = backupVerdict(backup);

        return <StateCell verdict={verdict} />;
      },
      sortValue: (backup) => backupVerdict(backup).label,
    },
    {
      title: "Cluster",
      className: "CNPG-table__shrink",
      cell: (backup) => (
        <CellLink
          title="Opens the cluster"
          onClick={() =>
            open("clusters", { namespace: backup.getNs(), name: backup.spec.cluster.name })
          }
        >
          {backup.spec.cluster.name}
        </CellLink>
      ),
      sortValue: (backup) => backup.spec.cluster.name,
    },
    {
      title: "Postgres",
      className: "CNPG-table__shrink",
      cell: (backup) => backup.status?.majorVersion ?? "—",
      sortValue: (backup) => backup.status?.majorVersion,
    },
    {
      title: "Method",
      className: "CNPG-table__shrink",
      cell: (backup) => backup.spec.method ?? "—",
      sortValue: (backup) => backup.spec.method,
    },
    {
      title: "Took",
      className: "CNPG-table__number",
      cell: (backup) => backupDuration(backup) ?? "—",
    },
    {
      title: "When",
      className: "CNPG-table__shrink",
      cell: (backup) => <span className="CNPG-muted">{ago(backupTime(backup), now)}</span>,
      sortValue: (backup) => Date.parse(backupTime(backup)),
    },
  ];

  return (
    <ListPage
      title="Backups"
      subline={
        stores.load.note ??
        "Newest first. The operator's error is on the state when a backup failed."
      }
      alarm={stores.load.alarm}
      section="cnpg-backups"
      rows={rows}
      limit={DRAWN}
      columns={columns}
      keyOf={keyOf}
      searchTexts={backupSearchTexts}
      filters={
        ofCluster && (
          <FilterChips
            filters={[ofCluster]}
            labels={{ [ofCluster]: `Cluster ${params?.cluster?.get()}` }}
            titles={{
              [ofCluster]: "Shows the backups of the cluster whose drawer opened this list",
            }}
            current={ofCluster}
            onChange={setOfCluster}
            section="cnpg-backup-filters"
          />
        )
      }
      action={
        <WithTooltip tooltip="Starts a backup of a cluster you pick, with its own method. Asks first">
          <button
            type="button"
            className="CNPG-button CNPG-button--primary"
            onClick={() => confirmBackupPicker(stores.clusters)}
          >
            Back up
          </button>
        </WithTooltip>
      }
      onOpen={(backup) => setSelectedKey(keyOf(backup))}
      selection={{
        hint: "Deletes the Backup objects only; their files stay in the object store.",
        actions: [
          bulkAction<BackupLike>({
            label: "Delete",
            done: "Deleted",
            kind: "backup",
            tooltip: "Deletes the ticked Backup objects; their files stay.",
            caution: true,
            nameOf: (backup) => backup.getName(),
            detail:
              "Only the objects go; their files stay until the retention policy removes them.",
            run: deleteBackup,
          }),
        ],
      }}
      menu={(backup) => <RowMenu actions={backupActions(backup)} />}
      empty={emptyText(stores.load, "No Backup objects in the namespaces in scope.")}
    >
      <BackupDrawer
        backup={selected}
        cause={cause}
        onClose={() => setSelectedKey(undefined)}
        open={open}
      />
    </ListPage>
  );
});
