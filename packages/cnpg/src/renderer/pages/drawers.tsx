import { observer } from "mobx-react";

import { ago, backupTime } from "../api/backups";
import type { Verdict } from "../api/clusters";
import { backupsFromSchedule, describeCron, entriesOf } from "../api/details";
import { dropsInPostgres, type LogicalRow } from "../api/logical";
import { backupDuration, backupVerdict } from "../api/rows";
import type { BackupLike, ClusterLike, PoolerLike, ScheduledBackupLike } from "../api/types";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import {
  confirmDeleteBackup,
  confirmDeleteLogical,
  confirmDeletePooler,
  confirmDeleteSchedule,
  confirmPause,
  confirmScheduleBackup,
  confirmSuspend,
} from "./row-dialogs";

const SHOWN_BACKUPS = 8;

/** The state for the drawer's banner, with barman's cause when one was read. */
function withCause(verdict: Verdict, cause?: string): Verdict {
  return cause ? { ...verdict, reason: `${verdict.reason} Cause: ${cause}` } : verdict;
}

function ClusterLink({ name, onOpen }: { name: string; onOpen: (name: string) => void }) {
  return (
    <button
      type="button"
      className="CNPG-link"
      title="Opens the cluster"
      onClick={(event) => {
        event.preventDefault();
        onOpen(name);
      }}
    >
      {name}
    </button>
  );
}

export const ScheduleDrawer = observer(
  ({
    schedule,
    verdict,
    cause,
    clusters,
    backups,
    onClose,
    onOpenCluster,
  }: {
    schedule?: ScheduledBackupLike;
    verdict?: Verdict;
    cause?: string;
    clusters: ClusterLike[];
    backups: BackupLike[];
    onClose: () => void;
    onOpenCluster: (name: string) => void;
  }) => {
    const now = Date.now();
    const started = schedule ? backupsFromSchedule(schedule, backups) : [];

    return (
      <ObjectDrawer
        open={Boolean(schedule && verdict)}
        kind="ScheduledBackup"
        name={schedule?.getName() ?? ""}
        onClose={onClose}
        state={verdict ? withCause(verdict, cause) : undefined}
        section="cnpg-schedule"
        actions={
          schedule
            ? [
                {
                  icon: "backup",
                  title: "Starts a backup now, as this schedule would. Asks first",
                  onClick: () => confirmScheduleBackup(schedule, clusters),
                },
                schedule.spec.suspend
                  ? {
                      icon: "play_arrow",
                      title: "Starts backups on its cron again. Asks first",
                      onClick: () => confirmSuspend(schedule, false),
                    }
                  : {
                      icon: "pause",
                      title: "Stops it starting backups until started again. Asks first",
                      onClick: () => confirmSuspend(schedule, true),
                    },
                {
                  icon: "delete",
                  title: "Deletes the schedule. Asks you to type its name",
                  onClick: () => confirmDeleteSchedule(schedule, backups),
                },
              ]
            : []
        }
      >
        {schedule && (
          <>
            <dl className="CNPG-facts">
              <dt>Namespace</dt>
              <dd>{schedule.getNs()}</dd>
              <dt>Cluster</dt>
              <dd>
                <ClusterLink name={schedule.spec.cluster.name} onOpen={onOpenCluster} />
              </dd>
              <dt>When</dt>
              <dd>
                {describeCron(schedule.spec.schedule)}{" "}
                <span className="CNPG-muted CNPG-mono">{schedule.spec.schedule}</span>
              </dd>
              <dt>Last run</dt>
              <dd>{schedule.status?.lastScheduleTime ?? "—"}</dd>
              <dt>Next run</dt>
              <dd>
                {schedule.spec.suspend
                  ? "None while suspended"
                  : (schedule.status?.nextScheduleTime ?? "—")}
              </dd>
              <dt>Method</dt>
              <dd>
                {schedule.spec.method ?? "barmanObjectStore"}
                {schedule.spec.pluginConfiguration && (
                  <span className="CNPG-muted"> · {schedule.spec.pluginConfiguration.name}</span>
                )}
              </dd>
              <dt>Runs on creation</dt>
              <dd>{schedule.spec.immediate ? "Yes" : "No"}</dd>
            </dl>

            <section className="CNPG-section" data-section="cnpg-schedule-backups">
              <h3 className="CNPG-section__title">Backups it started</h3>
              {started.length === 0 ? (
                <p className="CNPG-section__note">None yet.</p>
              ) : (
                <div className="CNPG-list">
                  {started.slice(0, SHOWN_BACKUPS).map((backup) => {
                    const state = backupVerdict(backup);

                    return (
                      <div key={backup.getName()} className="CNPG-row">
                        <span className="CNPG-row__main">
                          <span className="CNPG-row__name">
                            <b>{backup.getName()}</b>
                          </span>
                          <span className="CNPG-row__reason">
                            <Status tone={state.tone} label={state.label} />
                            {state.tone === "critical" && (
                              <span className="CNPG-muted"> · {state.reason}</span>
                            )}
                          </span>
                        </span>
                        <span className="CNPG-row__aside">{ago(backupTime(backup), now)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </ObjectDrawer>
    );
  },
);

export const BackupDrawer = observer(
  ({
    backup,
    cause,
    onClose,
    onOpenCluster,
  }: {
    backup?: BackupLike;
    cause?: string;
    onClose: () => void;
    onOpenCluster: (name: string) => void;
  }) => {
    const status = backup?.status;
    const verdict = backup ? backupVerdict(backup) : undefined;

    return (
      <ObjectDrawer
        open={Boolean(backup)}
        kind="Backup"
        name={backup?.getName() ?? ""}
        onClose={onClose}
        state={
          verdict ? withCause(verdict, verdict.tone === "critical" ? cause : undefined) : undefined
        }
        section="cnpg-backup"
        actions={
          backup
            ? [
                {
                  icon: "delete",
                  title: "Deletes the Backup object; its files stay. Asks you to type its name",
                  onClick: () => confirmDeleteBackup(backup),
                },
              ]
            : []
        }
      >
        {backup && (
          <dl className="CNPG-facts">
            <dt>Namespace</dt>
            <dd>{backup.getNs()}</dd>
            <dt>Cluster</dt>
            <dd>
              <ClusterLink name={backup.spec.cluster.name} onOpen={onOpenCluster} />
            </dd>
            <dt>Method</dt>
            <dd>
              {backup.spec.method ?? status?.method ?? "—"}
              {status?.online !== undefined && (
                <span className="CNPG-muted"> · {status.online ? "online" : "offline"}</span>
              )}
            </dd>
            <dt>Taken from</dt>
            <dd>{status?.instanceID?.podName ?? "—"}</dd>
            <dt>Started</dt>
            <dd>{status?.startedAt ?? status?.reconciliationStartedAt ?? "—"}</dd>
            <dt>Stopped</dt>
            <dd>
              {status?.stoppedAt ?? status?.reconciliationTerminatedAt ?? "—"}
              {backupDuration(backup) && (
                <span className="CNPG-muted"> · took {backupDuration(backup)}</span>
              )}
            </dd>
            <dt>Postgres</dt>
            <dd>{status?.majorVersion ?? "—"}</dd>
            <dt>WAL</dt>
            <dd className="CNPG-mono">
              {status?.beginWal ? `${status.beginWal} → ${status.endWal ?? "?"}` : "—"}
            </dd>
            <dt>LSN</dt>
            <dd className="CNPG-mono">
              {status?.beginLSN ? `${status.beginLSN} → ${status.endLSN ?? "?"}` : "—"}
            </dd>
            <dt>Backup ID</dt>
            <dd className="CNPG-mono">{status?.backupId ?? "—"}</dd>
            {status?.error && (
              <>
                <dt>Operator's error</dt>
                <dd className="CNPG-text--critical">{status.error}</dd>
              </>
            )}
          </dl>
        )}
      </ObjectDrawer>
    );
  },
);

export const PoolerDrawer = observer(
  ({
    pooler,
    verdict,
    onClose,
    onOpenCluster,
  }: {
    pooler?: PoolerLike;
    verdict?: Verdict;
    onClose: () => void;
    onOpenCluster: (name: string) => void;
  }) => {
    const parameters = entriesOf(pooler?.spec.pgbouncer?.parameters);

    return (
      <ObjectDrawer
        open={Boolean(pooler && verdict)}
        kind="Pooler"
        name={pooler?.getName() ?? ""}
        onClose={onClose}
        state={verdict}
        section="cnpg-pooler"
        actions={
          pooler
            ? [
                pooler.spec.pgbouncer?.paused
                  ? {
                      icon: "play_arrow",
                      title: "Lets queries through again. Asks first",
                      onClick: () => confirmPause(pooler, false),
                    }
                  : {
                      icon: "pause",
                      title: "Holds new queries, keeping connections open. Asks first",
                      onClick: () => confirmPause(pooler, true),
                    },
                {
                  icon: "delete",
                  title: "Deletes the pooler. Asks you to type its name",
                  onClick: () => confirmDeletePooler(pooler),
                },
              ]
            : []
        }
      >
        {pooler && (
          <>
            <dl className="CNPG-facts">
              <dt>Namespace</dt>
              <dd>{pooler.getNs()}</dd>
              <dt>Cluster</dt>
              <dd>
                <ClusterLink name={pooler.spec.cluster.name} onOpen={onOpenCluster} />
              </dd>
              <dt>Sends to</dt>
              <dd>
                {pooler.spec.type === "ro"
                  ? "Replicas (read-only)"
                  : pooler.spec.type === "r"
                    ? "Any instance"
                    : "The primary (read-write)"}
              </dd>
              <dt>Pool mode</dt>
              <dd>{pooler.spec.pgbouncer?.poolMode ?? "session"}</dd>
              <dt>Instances</dt>
              <dd>
                {pooler.spec.instances ?? 1}
                {pooler.status?.instances !== undefined && (
                  <span className="CNPG-muted"> · {pooler.status.instances} reported</span>
                )}
              </dd>
              <dt>Service</dt>
              <dd className="CNPG-mono">
                {pooler.getName()}.{pooler.getNs()}.svc
              </dd>
              <dt>Image</dt>
              <dd className="CNPG-mono">{pooler.status?.image ?? "—"}</dd>
            </dl>
            <section className="CNPG-section" data-section="cnpg-pooler-parameters">
              <h3 className="CNPG-section__title">PgBouncer parameters</h3>
              {parameters.length === 0 ? (
                <p className="CNPG-section__note">The operator's defaults.</p>
              ) : (
                <dl className="CNPG-facts">
                  {parameters.map(([key, value]) => (
                    <div key={key} style={{ display: "contents" }}>
                      <dt>{key}</dt>
                      <dd className="CNPG-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </>
        )}
      </ObjectDrawer>
    );
  },
);

export const LogicalDrawer = observer(
  ({
    row,
    onClose,
    onOpenCluster,
  }: {
    row?: LogicalRow;
    onClose: () => void;
    onOpenCluster: (name: string) => void;
  }) => (
    <ObjectDrawer
      open={Boolean(row)}
      kind={row?.kind ?? ""}
      name={row?.object.getName() ?? ""}
      onClose={onClose}
      state={row?.verdict}
      section="cnpg-logical-object"
      actions={
        row
          ? [
              {
                icon: "delete",
                title:
                  "Deletes the object; Postgres keeps it unless its reclaim policy is delete. Asks you to type its name",
                onClick: () => confirmDeleteLogical(row),
              },
            ]
          : []
      }
    >
      {row && (
        <dl className="CNPG-facts">
          <dt>Namespace</dt>
          <dd>{row.object.getNs()}</dd>
          <dt>Cluster</dt>
          <dd>
            <ClusterLink name={row.cluster} onOpen={onOpenCluster} />
          </dd>
          <dt>Database</dt>
          <dd>{row.database}</dd>
          <dt>Name in Postgres</dt>
          <dd className="CNPG-mono">{row.name}</dd>
          <dt>{row.kind === "Publication" ? "Publishes" : "Subscribes to"}</dt>
          <dd>{row.peer}</dd>
          <dt>On delete</dt>
          <dd>{dropsInPostgres(row) ? "Dropped in Postgres too" : "Kept in Postgres"}</dd>
          {row.object.status?.message && (
            <>
              <dt>Operator's message</dt>
              <dd className="CNPG-text--critical">{row.object.status.message}</dd>
            </>
          )}
        </dl>
      )}
    </ObjectDrawer>
  ),
);
