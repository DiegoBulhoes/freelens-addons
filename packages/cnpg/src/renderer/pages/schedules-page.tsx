import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import { createBackup, deleteSchedule, patchSchedule } from "../api/actions";
import { ago } from "../api/backups";
import { scheduleRefusal } from "../api/bulk";
import { wantsCause } from "../api/causes";
import { backupFromSchedule, suspendPatch } from "../api/operations";
import { scheduleVerdict } from "../api/rows";
import type { ScheduledBackupLike } from "../api/types";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { causeKey, useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { ScheduleDrawer } from "./drawers";
import { confirmDeleteSchedule, confirmScheduleBackup, confirmSuspend } from "./row-dialogs";

const {
  Component: { Icon, MenuItem },
} = Renderer;

export const SchedulesPage = observer(
  ({ onOpenCluster }: { onOpenCluster: (name: string) => void }) => {
    const stores = useCnpgStores();
    const [selectedKey, setSelectedKey] = useState<string>();
    const now = Date.now();
    const verdictOf = (schedule: ScheduledBackupLike) =>
      scheduleVerdict(schedule, stores.clusters, stores.backups, now);
    const clusterKeyOf = (schedule: ScheduledBackupLike) =>
      `${schedule.getNs()}/${schedule.spec.cluster.name}`;
    const failing = new Set(
      stores.schedules
        .filter((schedule) => wantsCause(verdictOf(schedule).label))
        .map(clusterKeyOf),
    );
    const causes = useCauses(stores.clusters.filter((cluster) => failing.has(causeKey(cluster))));

    const columns: Column<ScheduledBackupLike>[] = [
      {
        title: "Schedule",
        className: "CNPG-table__shrink",
        cell: (schedule) => (
          <>
            {schedule.getName()}
            <span className="CNPG-muted"> · {schedule.getNs()}</span>
          </>
        ),
        sortValue: (schedule) => schedule.getName(),
      },
      {
        title: "State",
        className: "CNPG-table__fill",
        cell: (schedule) => {
          const verdict = verdictOf(schedule);

          return (
            <StateCell
              verdict={verdict}
              cause={wantsCause(verdict.label) ? causes.get(clusterKeyOf(schedule)) : undefined}
            />
          );
        },
        sortValue: (schedule) => verdictOf(schedule).label,
      },
      {
        title: "Cluster",
        className: "CNPG-table__shrink",
        cell: (schedule) => (
          <button
            type="button"
            className="CNPG-link"
            title="Opens the cluster"
            onClick={(event) => {
              event.preventDefault();
              // The row opens a drawer; this link goes to the cluster instead.
              event.stopPropagation();
              onOpenCluster(schedule.spec.cluster.name);
            }}
          >
            {schedule.spec.cluster.name}
          </button>
        ),
        sortValue: (schedule) => schedule.spec.cluster.name,
      },
      {
        title: "Cron",
        className: "CNPG-table__shrink",
        cell: (schedule) => <code>{schedule.spec.schedule}</code>,
      },
      {
        title: "Last run",
        className: "CNPG-table__shrink",
        cell: (schedule) => (
          <span className="CNPG-muted">{ago(schedule.status?.lastScheduleTime, now)}</span>
        ),
        sortValue: (schedule) =>
          schedule.status?.lastScheduleTime
            ? Date.parse(schedule.status.lastScheduleTime)
            : undefined,
      },
      {
        title: "Next run",
        className: "CNPG-table__shrink",
        cell: (schedule) =>
          schedule.spec.suspend ? "—" : (schedule.status?.nextScheduleTime ?? "—"),
        sortValue: (schedule) => schedule.status?.nextScheduleTime,
      },
    ];

    return (
      <ListPage
        title="Scheduled backups"
        subline="A suspended schedule starts nothing; one whose last run failed is critical."
        section="cnpg-schedules"
        rows={stores.schedules}
        columns={columns}
        keyOf={(schedule) => `${schedule.getNs()}/${schedule.getName()}`}
        searchTexts={(schedule) => [
          schedule.getName(),
          schedule.spec.cluster.name,
          verdictOf(schedule).label,
        ]}
        onOpen={(schedule) => setSelectedKey(`${schedule.getNs()}/${schedule.getName()}`)}
        selection={{
          hint: "Each action reaches the ticked schedules it applies to; the rest are listed as skipped.",
          actions: [
            bulkAction<ScheduledBackupLike>({
              label: "Back up now",
              done: "Started backups from",
              kind: "schedule",
              tooltip: "Starts a backup now from each ticked schedule.",
              nameOf: (schedule) => schedule.getName(),
              refuse: scheduleRefusal("backup", stores.clusters),
              run: (schedule) => createBackup(backupFromSchedule(schedule, Date.now())),
            }),
            bulkAction<ScheduledBackupLike>({
              label: "Start",
              done: "Started",
              kind: "schedule",
              tooltip: "Starts the ticked suspended schedules again.",
              nameOf: (schedule) => schedule.getName(),
              refuse: scheduleRefusal("start", stores.clusters),
              run: (schedule) => patchSchedule(schedule, suspendPatch(false)),
            }),
            bulkAction<ScheduledBackupLike>({
              label: "Suspend",
              done: "Suspended",
              kind: "schedule",
              tooltip: "Suspends the ticked schedules.",
              caution: true,
              nameOf: (schedule) => schedule.getName(),
              refuse: scheduleRefusal("suspend", stores.clusters),
              run: (schedule) => patchSchedule(schedule, suspendPatch(true)),
            }),
            bulkAction<ScheduledBackupLike>({
              label: "Delete",
              done: "Deleted",
              kind: "schedule",
              tooltip: "Deletes the ticked schedules, with the Backup objects they own.",
              caution: true,
              nameOf: (schedule) => schedule.getName(),
              detail: "Backup objects a schedule owns go with it; their files stay.",
              run: deleteSchedule,
            }),
          ],
        }}
        menu={(schedule) => (
          <>
            <MenuItem onClick={() => confirmScheduleBackup(schedule, stores.clusters)}>
              <Icon
                material="backup"
                tooltip="Starts a backup now, as this schedule would. Asks first"
              />
              <span className="title">Back up now</span>
            </MenuItem>
            {schedule.spec.suspend ? (
              <MenuItem onClick={() => confirmSuspend(schedule, false)}>
                <Icon
                  material="play_arrow"
                  tooltip="Starts backups on its cron again. Asks first"
                />
                <span className="title">Start</span>
              </MenuItem>
            ) : (
              <MenuItem onClick={() => confirmSuspend(schedule, true)}>
                <Icon
                  material="pause"
                  tooltip="Stops it starting backups until started again. Asks first"
                />
                <span className="title">Suspend</span>
              </MenuItem>
            )}
            <MenuItem onClick={() => confirmDeleteSchedule(schedule, stores.backups)}>
              <Icon material="delete" tooltip="Deletes the schedule. Asks you to type its name" />
              <span className="title">Delete</span>
            </MenuItem>
          </>
        )}
        empty="No ScheduledBackups in the namespaces in scope."
      >
        {(() => {
          const selected = stores.schedules.find(
            (schedule) => `${schedule.getNs()}/${schedule.getName()}` === selectedKey,
          );
          const verdict = selected ? verdictOf(selected) : undefined;

          return (
            <ScheduleDrawer
              schedule={selected}
              verdict={verdict}
              cause={
                selected && verdict && wantsCause(verdict.label)
                  ? causes.get(clusterKeyOf(selected))
                  : undefined
              }
              clusters={stores.clusters}
              backups={stores.backups}
              onClose={() => setSelectedKey(undefined)}
              onOpenCluster={(name) => {
                setSelectedKey(undefined);
                onOpenCluster(name);
              }}
            />
          );
        })()}
      </ListPage>
    );
  },
);
