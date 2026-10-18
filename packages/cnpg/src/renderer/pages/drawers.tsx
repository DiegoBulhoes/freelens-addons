import { observer } from "mobx-react";
import { backupTime } from "../api/backups/backups";
import { backupsFromSchedule, describeCron, entriesOf } from "../api/backups/details";
import { dropsInPostgres, type LogicalRow } from "../api/replication/logical";
import { HOST_LIST_TITLES } from "../api/shared/host-links";
import type { OpenPage } from "../api/shared/navigation";
import {
  backupDuration,
  backupVerdict,
  type PoolerReady,
  SCHEDULE_LABEL,
} from "../api/shared/rows";
import type { BackupLike, ClusterLike, PoolerLike, ScheduledBackupLike } from "../api/shared/types";
import { ago, until, type Verdict, withCause } from "../api/shared/verdict";
import { DrawerLink, followHost, followPage } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import { backupActions, logicalActions, poolerActions, scheduleActions } from "./row-dialogs";

const SHOWN_BACKUPS = 8;

/** The cluster of an object, by the object's namespace: two clusters can share a name. */
function ClusterLink({
  namespace,
  name,
  onClose,
  open,
}: {
  namespace: string | undefined;
  name: string;
  onClose: () => void;
  open: OpenPage;
}) {
  return (
    <DrawerLink
      title="Opens the cluster"
      onClick={() => followPage(onClose, open, "clusters", { namespace, name })}
    >
      {name}
    </DrawerLink>
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
    open,
  }: {
    schedule?: ScheduledBackupLike;
    verdict?: Verdict;
    cause?: string;
    clusters: ClusterLike[];
    backups: BackupLike[];
    onClose: () => void;
    open: OpenPage;
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
        actions={schedule ? scheduleActions(schedule, clusters, backups) : []}
      >
        {schedule && (
          <>
            <dl className="CNPG-facts">
              <dt>Namespace</dt>
              <dd>{schedule.getNs()}</dd>
              <dt>Cluster</dt>
              <dd>
                <ClusterLink
                  namespace={schedule.getNs()}
                  name={schedule.spec.cluster.name}
                  onClose={onClose}
                  open={open}
                />
              </dd>
              <dt>When</dt>
              <dd>
                {describeCron(schedule.spec.schedule)}{" "}
                <span className="CNPG-muted CNPG-mono">{schedule.spec.schedule}</span>
              </dd>
              <dt>Last run</dt>
              <dd>
                {ago(schedule.status?.lastScheduleTime, now)}
                {schedule.status?.lastScheduleTime && (
                  <span className="CNPG-muted"> · {schedule.status.lastScheduleTime}</span>
                )}
              </dd>
              <dt>Next run</dt>
              <dd>
                {schedule.spec.suspend ? (
                  "None while suspended"
                ) : (
                  <>
                    {until(schedule.status?.nextScheduleTime, now)}
                    {schedule.status?.nextScheduleTime && (
                      <span className="CNPG-muted"> · {schedule.status.nextScheduleTime}</span>
                    )}
                  </>
                )}
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
                            <DrawerLink
                              title="Opens the backup"
                              onClick={() =>
                                followPage(onClose, open, "backups", {
                                  namespace: backup.getNs(),
                                  name: backup.getName(),
                                })
                              }
                            >
                              <b>{backup.getName()}</b>
                            </DrawerLink>
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
    open,
  }: {
    backup?: BackupLike;
    cause?: string;
    onClose: () => void;
    open: OpenPage;
  }) => {
    const status = backup?.status;
    const schedule = backup?.metadata.labels?.[SCHEDULE_LABEL];
    const pod = status?.instanceID?.podName;
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
        actions={backup ? backupActions(backup) : []}
      >
        {backup && (
          <dl className="CNPG-facts">
            <dt>Namespace</dt>
            <dd>{backup.getNs()}</dd>
            <dt>Cluster</dt>
            <dd>
              <ClusterLink
                namespace={backup.getNs()}
                name={backup.spec.cluster.name}
                onClose={onClose}
                open={open}
              />
            </dd>
            <dt>Schedule</dt>
            <dd>
              {schedule ? (
                <DrawerLink
                  title="Opens the schedule"
                  onClick={() =>
                    followPage(onClose, open, "schedules", {
                      namespace: backup.getNs(),
                      name: schedule,
                    })
                  }
                >
                  {schedule}
                </DrawerLink>
              ) : (
                "None; started by hand"
              )}
            </dd>
            <dt>Method</dt>
            <dd>
              {backup.spec.method ?? status?.method ?? "—"}
              {status?.online !== undefined && (
                <span className="CNPG-muted"> · {status.online ? "online" : "offline"}</span>
              )}
            </dd>
            <dt>Taken from</dt>
            <dd>
              {pod ? (
                <DrawerLink
                  title={HOST_LIST_TITLES.Pod}
                  onClick={() => followHost(onClose, "Pod", pod)}
                >
                  {pod}
                </DrawerLink>
              ) : (
                "—"
              )}
            </dd>
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
    ready,
    onClose,
    open,
  }: {
    pooler?: PoolerLike;
    verdict?: Verdict;
    /** Undefined while its pods are not read. */
    ready?: PoolerReady;
    onClose: () => void;
    open: OpenPage;
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
        actions={pooler ? poolerActions(pooler) : []}
      >
        {pooler && (
          <>
            <dl className="CNPG-facts">
              <dt>Namespace</dt>
              <dd>{pooler.getNs()}</dd>
              <dt>Cluster</dt>
              <dd>
                <ClusterLink
                  namespace={pooler.getNs()}
                  name={pooler.spec.cluster.name}
                  onClose={onClose}
                  open={open}
                />
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
                {ready && <span className="CNPG-muted"> · {ready.ready} ready</span>}
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
  ({ row, onClose, open }: { row?: LogicalRow; onClose: () => void; open: OpenPage }) => (
    <ObjectDrawer
      open={Boolean(row)}
      kind={row?.kind ?? ""}
      name={row?.object.getName() ?? ""}
      onClose={onClose}
      state={row?.verdict}
      section="cnpg-logical-object"
      actions={row ? logicalActions(row) : []}
    >
      {row && (
        <dl className="CNPG-facts">
          <dt>Namespace</dt>
          <dd>{row.object.getNs()}</dd>
          <dt>Cluster</dt>
          <dd>
            <ClusterLink
              namespace={row.object.getNs()}
              name={row.cluster}
              onClose={onClose}
              open={open}
            />
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
