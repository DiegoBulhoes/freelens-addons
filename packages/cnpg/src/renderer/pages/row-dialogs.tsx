import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import {
  createBackup,
  deleteBackup,
  deleteLogical,
  deletePooler,
  deleteSchedule,
  patchPooler,
  patchSchedule,
} from "../api/actions";
import { dropsInPostgres, type LogicalRow } from "../api/logical";
import {
  type BackupOptions,
  backupCandidates,
  backupFromSchedule,
  backupNow,
  ownedBackups,
  pausePatch,
  scheduleBackupRefusal,
  suspendPatch,
} from "../api/operations";
import type { BackupLike, ClusterLike, PoolerLike, ScheduledBackupLike } from "../api/types";
import { BackupOptionsForm } from "../clusters/backup-form";
import { confirmWrite, notifyDone } from "../components/confirm";

const {
  Component: { Notifications },
} = Renderer;

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
  const refused = scheduleBackupRefusal(schedule, clusters);

  if (refused) {
    Notifications.error(refused);
    return;
  }

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
      const manifest = backupFromSchedule(schedule, Date.now());

      try {
        await createBackup(manifest);
        notifyDone(`Backup ${manifest.metadata.name} started for ${cluster}.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not start a backup of ${cluster}`);
      }
    },
  });
}

function ClusterPicker({ names, onPick }: { names: string[]; onPick: (name: string) => void }) {
  const [picked, setPicked] = useState(names[0]);

  return (
    <div className="CNPG-form__field">
      <span>Cluster</span>
      <div className="CNPG-filters">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            className="CNPG-filter"
            aria-pressed={picked === name}
            title={`Backs up ${name}`}
            onClick={() => {
              setPicked(name);
              onPick(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function confirmBackupOf(clusters: ClusterLike[]): void {
  const candidates = backupCandidates(clusters);

  if (candidates.length === 0) {
    Notifications.error("No cluster in scope has a backup method and is running.");
    return;
  }

  const keyOf = (cluster: ClusterLike) => `${cluster.getNs()}/${cluster.getName()}`;
  let picked = keyOf(candidates[0] as ClusterLike);
  let options: BackupOptions = {};

  confirmWrite({
    question: "Back up which cluster now?",
    detail: "Creates a Backup with the cluster's own method, as kubectl cnpg backup does.",
    form: (
      <>
        <ClusterPicker
          names={candidates.map(keyOf)}
          onPick={(name) => {
            picked = name;
          }}
        />
        <BackupOptionsForm
          methods={[]}
          onChange={(next) => {
            options = { target: next.target };
          }}
        />
      </>
    ),
    label: "Back up",
    destructive: false,
    ok: async () => {
      const cluster = candidates.find((each) => keyOf(each) === picked);
      const manifest = cluster ? backupNow(cluster, Date.now(), options) : undefined;

      if (!cluster || !manifest) return;

      try {
        await createBackup(manifest);
        notifyDone(`Backup ${manifest.metadata.name} started for ${cluster.getName()}.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not start a backup of ${cluster.getName()}`);
      }
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
