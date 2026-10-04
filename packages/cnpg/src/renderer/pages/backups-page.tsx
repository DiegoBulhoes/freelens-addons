import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import { deleteBackup } from "../api/actions";
import { ago, backupsNewestFirst, backupTime } from "../api/backups";
import { backupDuration, backupVerdict } from "../api/rows";
import type { BackupLike } from "../api/types";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { causeKey, useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { BackupDrawer } from "./drawers";
import { confirmBackupOf, confirmDeleteBackup } from "./row-dialogs";

const {
  Component: { Icon, MenuItem, WithTooltip },
} = Renderer;

export const BackupsPage = observer(
  ({ onOpenCluster }: { onOpenCluster: (name: string) => void }) => {
    const stores = useCnpgStores();
    const [selectedKey, setSelectedKey] = useState<string>();
    const selected = stores.backups.find(
      (backup) => `${backup.getNs()}/${backup.getName()}` === selectedKey,
    );
    const failedCluster =
      selected?.status?.phase === "failed"
        ? stores.clusters.find(
            (cluster) =>
              cluster.getNs() === selected.getNs() &&
              cluster.getName() === selected.spec.cluster.name,
          )
        : undefined;
    const causes = useCauses(failedCluster ? [failedCluster] : []);
    const now = Date.now();
    const rows = backupsNewestFirst(stores.backups);

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
          <button
            type="button"
            className="CNPG-link"
            title="Opens the cluster"
            onClick={(event) => {
              event.preventDefault();
              // The row opens a drawer; this link goes to the cluster instead.
              event.stopPropagation();
              onOpenCluster(backup.spec.cluster.name);
            }}
          >
            {backup.spec.cluster.name}
          </button>
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
        subline="Newest first. The operator's error is on the state when a backup failed."
        section="cnpg-backups"
        rows={rows}
        columns={columns}
        keyOf={(backup) => `${backup.getNs()}/${backup.getName()}`}
        searchTexts={(backup) => [
          backup.getName(),
          backup.spec.cluster.name,
          backupVerdict(backup).label,
        ]}
        action={
          <WithTooltip tooltip="Starts a backup of a cluster you pick, with its own method. Asks first">
            <button
              type="button"
              className="CNPG-button CNPG-button--primary"
              onClick={() => confirmBackupOf(stores.clusters)}
            >
              Back up
            </button>
          </WithTooltip>
        }
        onOpen={(backup) => setSelectedKey(`${backup.getNs()}/${backup.getName()}`)}
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
        menu={(backup) => (
          <MenuItem onClick={() => confirmDeleteBackup(backup)}>
            <Icon
              material="delete"
              tooltip="Deletes the Backup object; its files stay. Asks you to type its name"
            />
            <span className="title">Delete</span>
          </MenuItem>
        )}
        empty="No Backup objects in the namespaces in scope."
      >
        <BackupDrawer
          backup={selected}
          cause={failedCluster ? causes.get(causeKey(failedCluster)) : undefined}
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
