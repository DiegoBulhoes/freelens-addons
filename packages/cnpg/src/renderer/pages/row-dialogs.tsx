import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import {
  type BackupOptions,
  backupCandidates,
  backupMethods,
  ownedBackups,
  pickedBackup,
  scheduleBackupManifest,
  scheduleBackupRefusal,
} from "../api/backups/backup-manifests";
import { dropsInPostgres, type LogicalRow } from "../api/replication/logical";
import { keyOf } from "../api/shared/navigation";
import type { BackupLike, ClusterLike, PoolerLike, ScheduledBackupLike } from "../api/shared/types";
import {
  deleteBackup,
  deleteLogical,
  deletePooler,
  deleteSchedule,
  patchPooler,
  patchSchedule,
} from "../api/writes/actions";
import { pausePatch, suspendPatch } from "../api/writes/operations";
import { BackupOptionsForm } from "../clusters/backup-form";
import { notifyRefusal, startBackup } from "../clusters/dialogs";
import { confirmWrite, notifyDone } from "../components/confirm";
import type { DrawerAction } from "../components/object-drawer";

const {
  Component: { Icon, MenuItem, Notifications, Select },
} = Renderer;

export interface RowAction extends DrawerAction {
  label: string;
}

export function RowMenu({ actions }: { actions: RowAction[] }) {
  return (
    <>
      {actions.map((action) => (
        <MenuItem key={action.label} onClick={action.onClick}>
          <Icon material={action.icon} tooltip={action.title} />
          <span className="title">{action.label}</span>
        </MenuItem>
      ))}
    </>
  );
}

export function confirmSuspend(schedule: ScheduledBackupLike, suspend: boolean): void {
  const name = schedule.getName();
  const set = (on: boolean) => patchSchedule(schedule, suspendPatch(on));

  confirmWrite({
    question: (
      <>
        {suspend ? "Suspend" : "Start"} schedule <b>{name}</b>?
      </>
    ),
    detail: suspend
      ? `No backup of ${schedule.spec.cluster.name} starts from it until it is started again.`
      : `Backups of ${schedule.spec.cluster.name} start again on its cron.`,
    label: suspend ? "Suspend" : "Start",
    destructive: suspend,
    ok: async () => {
      try {
        await set(suspend);
        notifyDone(`${suspend ? "Suspended" : "Started"} ${name}.`, { run: () => set(!suspend) });
      } catch (error) {
        Notifications.checkedError(error, `Could not ${suspend ? "suspend" : "start"} ${name}`);
      }
    },
  });
}

export function confirmPause(pooler: PoolerLike, pause: boolean): void {
  const name = pooler.getName();
  const set = (on: boolean) => patchPooler(pooler, pausePatch(on));

  confirmWrite({
    question: (
      <>
        {pause ? "Pause" : "Start"} pooler <b>{name}</b>?
      </>
    ),
    detail: pause
      ? "PgBouncer keeps the connections open and holds every new query until started again."
      : "PgBouncer passes queries through again.",
    label: pause ? "Pause" : "Start",
    destructive: pause,
    ok: async () => {
      try {
        await set(pause);
        notifyDone(`${pause ? "Paused" : "Started"} ${name}.`, { run: () => set(!pause) });
      } catch (error) {
        Notifications.checkedError(error, `Could not ${pause ? "pause" : "start"} ${name}`);
      }
    },
  });
}

export function confirmScheduleBackup(
  schedule: ScheduledBackupLike,
  clusters: ClusterLike[],
): void {
  if (notifyRefusal(scheduleBackupRefusal(schedule, clusters))) return;

  const cluster = schedule.spec.cluster.name;

  confirmWrite({
    question: (
      <>
        Back up <b>{cluster}</b> now, as <b>{schedule.getName()}</b> would?
      </>
    ),
    detail: "Creates a Backup with the schedule's method. Its cron is not changed.",
    label: "Back up",
    destructive: false,
    ok: async () => {
      await startBackup(scheduleBackupManifest(schedule, Date.now()), cluster);
    },
  });
}

interface Choice {
  value: string;
  label: string;
}

/** Reports through a callback: the dialog copies plain-object props. */
function BackupPickerForm({
  candidates,
  onChange,
}: {
  candidates: ClusterLike[];
  onChange: (picked: string, options: BackupOptions) => void;
}) {
  const [picked, setPicked] = useState(keyOf(candidates[0] as ClusterLike));
  const methodsOf = (key: string) => {
    const cluster = candidates.find((each) => keyOf(each) === key);

    return cluster ? backupMethods(cluster) : [];
  };

  return (
    <>
      <div className="CNPG-form__field">
        <span>Cluster</span>
        <Select<string, Choice, false>
          id="cnpg-backup-cluster-select"
          options={candidates.map((cluster) => ({
            value: keyOf(cluster),
            label: keyOf(cluster),
          }))}
          value={picked}
          themeName="lens"
          menuPlacement="auto"
          onChange={(option) => {
            if (!option) return;
            setPicked(option.value);
            onChange(option.value, { method: methodsOf(option.value)[0] });
          }}
        />
      </div>
      {/* Keyed so the form starts over from the picked cluster's own methods. */}
      <BackupOptionsForm
        key={picked}
        methods={methodsOf(picked)}
        onChange={(next) => onChange(picked, next)}
      />
    </>
  );
}

export function confirmBackupPicker(clusters: ClusterLike[]): void {
  const candidates = backupCandidates(clusters);

  if (candidates.length === 0) {
    Notifications.error("No cluster in scope has a backup method and is running.");
    return;
  }

  const first = candidates[0] as ClusterLike;
  let picked = keyOf(first);
  let options: BackupOptions = { method: backupMethods(first)[0] };

  confirmWrite({
    question: "Back up which cluster now?",
    detail: "Creates a Backup with the cluster's own method, as kubectl cnpg backup does.",
    form: (
      <BackupPickerForm
        candidates={candidates}
        onChange={(key, next) => {
          picked = key;
          options = next;
        }}
      />
    ),
    label: "Back up",
    destructive: false,
    ok: async () => {
      const backup = pickedBackup(candidates, picked, options, Date.now());

      if (!backup) return;

      await startBackup(backup.manifest, backup.cluster.getName());
    },
  });
}

function confirmDelete(kind: string, name: string, detail: string, run: () => Promise<void>): void {
  confirmWrite({
    question: (
      <>
        Delete {kind} <b>{name}</b>?
      </>
    ),
    detail,
    label: "Delete",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await run();
        notifyDone(`Deleted ${kind} ${name}.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not delete ${name}`);
      }
    },
  });
}

export function confirmDeleteBackup(backup: BackupLike): void {
  confirmDelete(
    "backup",
    backup.getName(),
    "Deletes the Backup object only. Its files stay in the object store until its retention policy removes them, so a restore can still use them.",
    () => deleteBackup(backup),
  );
}

export function confirmDeleteSchedule(schedule: ScheduledBackupLike, backups: BackupLike[]): void {
  const owned = ownedBackups(schedule, backups).length;

  confirmDelete(
    "schedule",
    schedule.getName(),
    owned > 0
      ? `No more backups start from it. It owns ${owned} Backup object${owned === 1 ? "" : "s"}, deleted with it; their files stay in the object store.`
      : "No more backups start from it. The backups it took are kept.",
    () => deleteSchedule(schedule),
  );
}

export function confirmDeletePooler(pooler: PoolerLike): void {
  confirmDelete(
    "pooler",
    pooler.getName(),
    `Removes PgBouncer in front of ${pooler.spec.cluster.name}. Connections through it drop; the cluster is not touched.`,
    () => deletePooler(pooler),
  );
}

export function confirmDeleteLogical(row: LogicalRow): void {
  const kind = row.kind.toLowerCase();

  confirmDelete(
    kind,
    row.object.getName(),
    dropsInPostgres(row)
      ? `Its reclaim policy is delete: the ${kind} ${row.name} is dropped in Postgres too.`
      : `Only the object goes. The ${kind} ${row.name} stays in Postgres, as its reclaim policy is retain.`,
    () => deleteLogical(row.object, row.kind),
  );
}

export function scheduleActions(
  schedule: ScheduledBackupLike,
  clusters: ClusterLike[],
  backups: BackupLike[],
): RowAction[] {
  return [
    {
      icon: "backup",
      label: "Back up now",
      title: "Starts a backup now, as this schedule would. Asks first",
      onClick: () => confirmScheduleBackup(schedule, clusters),
    },
    schedule.spec.suspend
      ? {
          icon: "play_arrow",
          label: "Start",
          title: "Starts backups on its cron again. Asks first",
          onClick: () => confirmSuspend(schedule, false),
        }
      : {
          icon: "pause",
          label: "Suspend",
          title: "Stops it starting backups until started again. Asks first",
          onClick: () => confirmSuspend(schedule, true),
        },
    {
      icon: "delete",
      label: "Delete",
      title: "Deletes the schedule. Asks you to type its name",
      onClick: () => confirmDeleteSchedule(schedule, backups),
    },
  ];
}

export function poolerActions(pooler: PoolerLike): RowAction[] {
  return [
    pooler.spec.pgbouncer?.paused
      ? {
          icon: "play_arrow",
          label: "Start",
          title: "Lets queries through again. Asks first",
          onClick: () => confirmPause(pooler, false),
        }
      : {
          icon: "pause",
          label: "Pause",
          title: "Holds new queries, keeping connections open. Asks first",
          onClick: () => confirmPause(pooler, true),
        },
    {
      icon: "delete",
      label: "Delete",
      title: "Deletes the pooler. Asks you to type its name",
      onClick: () => confirmDeletePooler(pooler),
    },
  ];
}

export function backupActions(backup: BackupLike): RowAction[] {
  return [
    {
      icon: "delete",
      label: "Delete",
      title: "Deletes the Backup object; its files stay. Asks you to type its name",
      onClick: () => confirmDeleteBackup(backup),
    },
  ];
}

export function logicalActions(row: LogicalRow): RowAction[] {
  return [
    {
      icon: "delete",
      label: "Delete",
      title:
        "Deletes the object; Postgres keeps it unless its reclaim policy is delete. Asks you to type its name",
      onClick: () => confirmDeleteLogical(row),
    },
  ];
}
