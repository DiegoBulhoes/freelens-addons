import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import type { ClusterRow } from "../api/attention";
import { ago, backupTime } from "../api/backups";
import { isHibernated, lastSwitchover, replicaNames, worse } from "../api/clusters";
import { clusterCommands } from "../api/operations";
import { formatBytes } from "../api/replication";
import {
  backupsOf,
  backupVerdict,
  poolersOf,
  poolerVerdict,
  schedulesOf,
  scheduleVerdict,
} from "../api/rows";
import { describeUptime, totalBytes } from "../api/summary";
import {
  certificateExpiries,
  clusterEvents,
  describeExpiry,
  eventTime,
  upkeepIssues,
  volumeProblems,
} from "../api/upkeep";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import type { CnpgStores } from "../hooks/use-cnpg-stores";
import { useInstanceStatuses } from "../hooks/use-instance-statuses";
import { useMetrics } from "../hooks/use-metrics";
import {
  confirmBackup,
  confirmHibernate,
  confirmPromote,
  confirmReload,
  confirmRestart,
  confirmWake,
} from "./dialogs";
import { DeclaredSections, ReplicationSection } from "./health-sections";
import { InstancesSection, openPsql } from "./instances-section";
import { LogSection } from "./log-section";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

const SHOWN_BACKUPS = 5;
const SHOWN_WARNINGS = 8;

async function copy(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    Notifications.ok(`${label} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy ${label.toLowerCase()}`);
  }
}

function stateOf(row: ClusterRow | undefined, cause: string | undefined, now: number) {
  if (!row) return undefined;

  const state = upkeepIssues(row.cluster, now).reduce(worse, worse(row.health, row.backup));

  return cause && state === row.backup
    ? { ...state, reason: `${state.reason} Cause: ${cause}` }
    : state;
}

interface ClusterDrawerProps {
  row?: ClusterRow;
  /** Barman's own error, read from its log. */
  cause?: string;
  inventory: CnpgStores;
  onClose: () => void;
}

export const ClusterDrawer = observer(({ row, cause, inventory, onClose }: ClusterDrawerProps) => {
  const cluster = row?.cluster;
  const now = Date.now();
  const hibernated = cluster ? isHibernated(cluster) : false;
  const metrics = useMetrics(cluster && !hibernated ? cluster : undefined);
  const statuses = useInstanceStatuses(
    cluster && !hibernated
      ? (cluster.status?.instanceNames ?? []).map((name) => `${cluster.getNs()}/${name}`)
      : [],
  );

  return (
    <ObjectDrawer
      open={Boolean(row)}
      kind="Cluster"
      name={cluster?.getName() ?? ""}
      onClose={onClose}
      state={stateOf(row, cause, now)}
      section="cnpg-cluster"
      actions={
        cluster
          ? [
              {
                icon: "terminal",
                title: "Opens psql on the primary, in a terminal tab",
                onClick: () => void openPsql(cluster, cluster.status?.currentPrimary),
              },
              {
                icon: "backup",
                title: "Starts a backup now, with the cluster's own method. Asks first",
                onClick: () => confirmBackup(cluster),
              },
              {
                icon: "sync",
                title: "Reloads the configuration without restarting. Asks first",
                onClick: () => confirmReload(cluster),
              },
              {
                icon: "swap_horiz",
                title: "Promotes a replica to primary. Asks you to type the cluster's name",
                onClick: () => confirmPromote(cluster),
              },
              hibernated
                ? {
                    icon: "wb_sunny",
                    title: "Wakes the cluster on its kept volumes. Asks first",
                    onClick: () => confirmWake(cluster),
                  }
                : {
                    icon: "bedtime",
                    title: "Stops the cluster and keeps its volumes. Asks you to type its name",
                    onClick: () => confirmHibernate(cluster),
                  },
              {
                icon: "restart_alt",
                title: "Recreates every instance, one at a time. Asks you to type its name",
                onClick: () => confirmRestart(cluster),
              },
            ]
          : []
      }
    >
      {cluster && row && (
        <>
          <dl className="CNPG-facts">
            <dt>Namespace</dt>
            <dd>{cluster.getNs()}</dd>
            <dt>State</dt>
            <dd>
              <Status tone={row.health.tone} label={row.health.label} />
            </dd>
            <dt>Backups</dt>
            <dd>
              <Status tone={row.backup.tone} label={row.backup.label} />
            </dd>
            <dt>Primary</dt>
            <dd>{cluster.status?.currentPrimary ?? "—"}</dd>
            <dt>Replicas</dt>
            <dd>{replicaNames(cluster).join(", ") || "None"}</dd>
            <dt>Last switchover</dt>
            <dd>{lastSwitchover(cluster) ?? "None since it was created"}</dd>
            <dt>Recoverable since</dt>
            <dd>{row.recoverableFrom ?? "—"}</dd>
            <dt>System ID</dt>
            <dd className="CNPG-mono">{cluster.status?.systemID ?? "—"}</dd>
            <dt>WAL position</dt>
            <dd className="CNPG-mono">
              {statuses[`${cluster.getNs()}/${cluster.status?.currentPrimary}`]?.currentLsn ?? "—"}
            </dd>
            <dt>Postgres up</dt>
            <dd>
              {metrics?.startedAt
                ? `${describeUptime(metrics, now)}, since ${new Date(metrics.startedAt).toISOString()}`
                : "—"}
            </dd>
            <dt>Size</dt>
            <dd>
              {metrics && metrics.databases.length > 0 ? (
                <>
                  {formatBytes(totalBytes(metrics))}
                  <span className="CNPG-muted">
                    {" "}
                    ·{" "}
                    {metrics.databases
                      .map((database) => `${database.name} ${formatBytes(database.bytes)}`)
                      .join(" · ")}
                  </span>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>Image</dt>
            <dd className="CNPG-mono">{cluster.status?.image ?? cluster.spec.imageName ?? "—"}</dd>
          </dl>

          <InstancesSection cluster={cluster} statuses={statuses} pods={inventory.pods} />

          <ReplicationSection
            primary={statuses[`${cluster.getNs()}/${cluster.status?.currentPrimary}`]}
          />

          {volumeProblems(cluster).length > 0 && (
            <section className="CNPG-section" data-section="cnpg-volumes">
              <h3 className="CNPG-section__title">Volumes</h3>
              <div className="CNPG-list">
                {volumeProblems(cluster).map((problem) => (
                  <div
                    key={`${problem.pvc}/${problem.verdict.label}`}
                    className={`CNPG-row CNPG-row--${problem.verdict.tone}`}
                  >
                    <span className="CNPG-row__state">{problem.verdict.label}</span>
                    <span className="CNPG-row__main">
                      <span className="CNPG-row__name">
                        <b>{problem.pvc}</b>
                      </span>
                      <span className="CNPG-row__reason">{problem.verdict.reason}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="CNPG-section" data-section="cnpg-cluster-backups">
            <h3 className="CNPG-section__title">Recent backups</h3>
            {backupsOf(cluster, inventory.backups).length === 0 ? (
              <p className="CNPG-section__note">No Backup objects for this cluster.</p>
            ) : (
              <div className="CNPG-list">
                {backupsOf(cluster, inventory.backups)
                  .slice(0, SHOWN_BACKUPS)
                  .map((backup) => {
                    const verdict = backupVerdict(backup);

                    return (
                      <div key={backup.getName()} className="CNPG-row">
                        <span className="CNPG-row__main">
                          <span className="CNPG-row__name">
                            <b>{backup.getName()}</b>
                            <span className="CNPG-row__meta">{backup.spec.method ?? "—"}</span>
                          </span>
                          <span className="CNPG-row__reason">
                            <Status tone={verdict.tone} label={verdict.label} />
                            {verdict.tone === "critical" && (
                              <span className="CNPG-muted"> {verdict.reason}</span>
                            )}
                          </span>
                        </span>
                        <span className="CNPG-row__aside">{ago(backupTime(backup), now)}</span>
                      </div>
                    );
                  })}
              </div>
            )}
            {schedulesOf(cluster, inventory.schedules).map((schedule) => {
              const verdict = scheduleVerdict(schedule, inventory.clusters, inventory.backups, now);

              return (
                <p key={schedule.getName()} className="CNPG-hint">
                  Schedule <b>{schedule.getName()}</b> (<code>{schedule.spec.schedule}</code>){" "}
                  <Status tone={verdict.tone} label={verdict.label} />
                </p>
              );
            })}
          </section>

          {poolersOf(cluster, inventory.poolers).length > 0 && (
            <section className="CNPG-section" data-section="cnpg-cluster-poolers">
              <h3 className="CNPG-section__title">Poolers</h3>
              <div className="CNPG-chips">
                {poolersOf(cluster, inventory.poolers).map((pooler) => (
                  <span key={pooler.getName()} className="CNPG-chip">
                    {pooler.getName()}
                    <span className="CNPG-chip__meta">
                      {" "}
                      {pooler.spec.type} · {poolerVerdict(pooler, inventory.clusters).label}
                    </span>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="CNPG-section" data-section="cnpg-certificates">
            <h3 className="CNPG-section__title">Certificates</h3>
            {certificateExpiries(cluster, now).length === 0 ? (
              <p className="CNPG-section__note">None reported yet.</p>
            ) : (
              <dl className="CNPG-facts">
                {certificateExpiries(cluster, now).map((expiry) => (
                  <div key={expiry.secret} style={{ display: "contents" }}>
                    <dt>{expiry.secret}</dt>
                    <dd>
                      <Status tone={expiry.tone} label={describeExpiry(expiry, now)} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="CNPG-hint">
              The operator renews the ones it issued a week before they expire.
            </p>
          </section>

          <section className="CNPG-section" data-section="cnpg-warnings">
            <h3 className="CNPG-section__title">Recent warnings</h3>
            {clusterEvents(inventory.events, cluster, inventory.backups).length === 0 ? (
              <p className="CNPG-section__note">
                No warning events for the cluster, its instances or its backups.
              </p>
            ) : (
              <div className="CNPG-list">
                {clusterEvents(inventory.events, cluster, inventory.backups)
                  .slice(0, SHOWN_WARNINGS)
                  .map((event) => (
                    <div key={event.getName()} className="CNPG-row CNPG-row--warning">
                      <span className="CNPG-row__main">
                        <span className="CNPG-row__name">
                          <b>{event.reason ?? "Warning"}</b>
                          <span className="CNPG-row__meta">
                            {event.involvedObject.kind} {event.involvedObject.name}
                            {(event.count ?? 1) > 1 && ` · ${event.count} times`}
                          </span>
                        </span>
                        <span className="CNPG-row__reason">{event.message}</span>
                      </span>
                      <span className="CNPG-row__aside">{ago(eventTime(event), now)}</span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <DeclaredSections cluster={cluster} budgets={inventory.budgets} />

          <LogSection cluster={cluster} />

          <section className="CNPG-section" data-section="cnpg-commands">
            <h3 className="CNPG-section__title">Look further</h3>
            <div className="CNPG-list">
              {clusterCommands(cluster).map(({ label, command }) => (
                <div key={label} className="CNPG-row">
                  <span className="CNPG-row__main">
                    <span className="CNPG-row__name">{label}</span>
                    <code className="CNPG-row__reason">{command}</code>
                  </span>
                  <span className="CNPG-row__actions">
                    <WithTooltip tooltip="Copies the command, to paste into a terminal">
                      <button
                        type="button"
                        className="CNPG-button"
                        onClick={() => void copy(label, command)}
                      >
                        Copy
                      </button>
                    </WithTooltip>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </ObjectDrawer>
  );
});
