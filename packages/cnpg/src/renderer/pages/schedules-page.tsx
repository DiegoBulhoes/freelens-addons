import { observer } from "mobx-react";
import { scheduleBackupManifest } from "../api/backups/backup-manifests";
import { failedBackupOf, wantsCause } from "../api/backups/causes";
import { describeCron } from "../api/backups/details";
import { keyOf, type OpenPage } from "../api/shared/navigation";
import { clusterNamed, indexInventory, scheduleVerdict } from "../api/shared/rows";
import { scheduleSearchTexts } from "../api/shared/search";
import { emptyText } from "../api/shared/store-state";
import type { ScheduledBackupLike } from "../api/shared/types";
import { ago, until } from "../api/shared/verdict";
import { createBackup, deleteSchedule, patchSchedule } from "../api/writes/actions";
import { scheduleRefusal } from "../api/writes/bulk";
import { suspendPatch } from "../api/writes/operations";
import { bulkAction } from "../components/bulk";
import { CellLink } from "../components/drawer-link";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useCauses } from "../hooks/use-causes";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useNamedRow } from "../hooks/use-list-params";
import { ScheduleDrawer } from "./drawers";
import type { ListParams } from "./list-params";
import { RowMenu, scheduleActions } from "./row-dialogs";

export const SchedulesPage = observer(
  ({ params, open }: { params?: ListParams; open: OpenPage }) => {
    const stores = useCnpgStores("schedules");
    const [selectedKey, setSelectedKey] = useNamedRow(params);
    const now = Date.now();
    const index = indexInventory(stores);
    // Once per render: sorting, searching and the cells all ask again.
    const verdicts = new Map(
      stores.schedules.map((schedule) => [
        schedule,
        scheduleVerdict(schedule, stores.clusters, index, now),
      ]),
    );
    const verdictOf = (schedule: ScheduledBackupLike) =>
      verdicts.get(schedule) ?? scheduleVerdict(schedule, stores.clusters, index, now);
    const causes = useCauses(
      stores.schedules.map((schedule) => ({
        key: keyOf(schedule),
        cluster: clusterNamed(stores.clusters, schedule.getNs(), schedule.spec.cluster.name),
        label: verdictOf(schedule).label,
        failed: failedBackupOf(
          {
            kind: "ScheduledBackup",
            namespace: schedule.getNs(),
            name: schedule.getName(),
            cluster: schedule.spec.cluster.name,
          },
          index,
        ),
      })),
    );

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
              cause={wantsCause(verdict.label) ? causes.get(keyOf(schedule)) : undefined}
            />
          );
        },
        sortValue: (schedule) => verdictOf(schedule).label,
      },
      {
        title: "Cluster",
        className: "CNPG-table__shrink",
        cell: (schedule) => (
          <CellLink
            title="Opens the cluster"
            onClick={() =>
              open("clusters", { namespace: schedule.getNs(), name: schedule.spec.cluster.name })
            }
          >
            {schedule.spec.cluster.name}
          </CellLink>
        ),
        sortValue: (schedule) => schedule.spec.cluster.name,
      },
      {
        title: "When",
        className: "CNPG-table__shrink",
        cell: (schedule) => (
          <span title={schedule.spec.schedule}>{describeCron(schedule.spec.schedule)}</span>
        ),
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
        cell: (schedule) => (
          <span className="CNPG-muted" title={schedule.status?.nextScheduleTime}>
            {schedule.spec.suspend ? "—" : until(schedule.status?.nextScheduleTime, now)}
          </span>
        ),
        sortValue: (schedule) =>
          !schedule.spec.suspend && schedule.status?.nextScheduleTime
            ? Date.parse(schedule.status.nextScheduleTime)
            : undefined,
      },
    ];

    const selected = stores.schedules.find((schedule) => keyOf(schedule) === selectedKey);
    const selectedVerdict = selected ? verdictOf(selected) : undefined;

    return (
      <ListPage
        title="Scheduled backups"
        subline={
          stores.load.note ??
          "A suspended schedule starts nothing; one whose last run failed is critical."
        }
        alarm={stores.load.alarm}
        section="cnpg-schedules"
        rows={stores.schedules}
        columns={columns}
        keyOf={keyOf}
        searchTexts={(schedule) => scheduleSearchTexts(schedule, verdictOf(schedule))}
        onOpen={(schedule) => setSelectedKey(keyOf(schedule))}
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
              run: (schedule) => createBackup(scheduleBackupManifest(schedule, Date.now())),
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
          <RowMenu actions={scheduleActions(schedule, stores.clusters, stores.backups)} />
        )}
        empty={emptyText(stores.load, "No ScheduledBackups in the namespaces in scope.")}
      >
        <ScheduleDrawer
          schedule={selected}
          verdict={selectedVerdict}
          cause={
            selected && selectedVerdict && wantsCause(selectedVerdict.label)
              ? causes.get(keyOf(selected))
              : undefined
          }
          clusters={stores.clusters}
          backups={stores.backups}
          onClose={() => setSelectedKey(undefined)}
          open={open}
        />
      </ListPage>
    );
  },
);
