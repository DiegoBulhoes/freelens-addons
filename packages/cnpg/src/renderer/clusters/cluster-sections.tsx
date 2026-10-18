import { backupTime } from "../api/backups/backups";
import { describeSource, tlsSecretsOf } from "../api/clusters/connection";
import { type SecretListings, secretsIn, secretsRefusal } from "../api/clusters/secret-metadata";
import {
  certificateExpiries,
  describeExpiry,
  eventTime,
  volumeProblems,
} from "../api/clusters/upkeep";
import { HOST_LIST_TITLES } from "../api/shared/host-links";
import type { OpenPage } from "../api/shared/navigation";
import {
  backupVerdict,
  type InventoryIndex,
  poolersOf,
  poolerVerdict,
  scheduleVerdict,
} from "../api/shared/rows";
import type {
  BackupLike,
  ClusterLike,
  EventLike,
  PodLike,
  PoolerLike,
  ScheduledBackupLike,
} from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { DrawerLink, followHost, followPage } from "../components/drawer-link";
import { Status } from "../components/status";

const SHOWN_BACKUPS = 5;
const SHOWN_WARNINGS = 8;

export function VolumesSection({
  cluster,
  onClose,
}: {
  cluster: ClusterLike;
  onClose: () => void;
}) {
  const problems = volumeProblems(cluster);

  if (problems.length === 0) return null;

  return (
    <section className="CNPG-section" data-section="cnpg-volumes">
      <h3 className="CNPG-section__title">Volumes</h3>
      <div className="CNPG-list">
        {problems.map((problem) => (
          <div
            key={`${problem.pvc}/${problem.verdict.label}`}
            className={`CNPG-row CNPG-row--${problem.verdict.tone}`}
          >
            <span className="CNPG-row__state">{problem.verdict.label}</span>
            <span className="CNPG-row__main">
              <span className="CNPG-row__name">
                <DrawerLink
                  title={HOST_LIST_TITLES.PersistentVolumeClaim}
                  onClick={() => followHost(onClose, "PersistentVolumeClaim", problem.pvc)}
                >
                  <b>{problem.pvc}</b>
                </DrawerLink>
              </span>
              <span className="CNPG-row__reason">{problem.verdict.reason}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RecentBackupsSection({
  cluster,
  backups,
  schedules,
  clusters,
  index,
  now,
  onClose,
  open,
}: {
  cluster: ClusterLike;
  backups: BackupLike[];
  schedules: ScheduledBackupLike[];
  clusters: ClusterLike[];
  index: InventoryIndex;
  now: number;
  onClose: () => void;
  open: OpenPage;
}) {
  const namespace = cluster.getNs();

  return (
    <section className="CNPG-section" data-section="cnpg-cluster-backups">
      <div className="CNPG-section__bar">
        <h3 className="CNPG-section__title">Recent backups</h3>
        {backups.length > 0 && (
          <DrawerLink
            title="Opens the Backups list on this cluster's backups"
            onClick={() =>
              followPage(onClose, open, "backups", {
                namespace,
                cluster: cluster.getName(),
              })
            }
          >
            All {backups.length} backup{backups.length === 1 ? "" : "s"}
          </DrawerLink>
        )}
      </div>
      {backups.length === 0 ? (
        <p className="CNPG-section__note">No Backup objects for this cluster.</p>
      ) : (
        <div className="CNPG-list">
          {backups.slice(0, SHOWN_BACKUPS).map((backup) => {
            const verdict = backupVerdict(backup);

            return (
              <div key={backup.getName()} className="CNPG-row">
                <span className="CNPG-row__main">
                  <span className="CNPG-row__name">
                    <DrawerLink
                      title="Opens the backup"
                      onClick={() =>
                        followPage(onClose, open, "backups", {
                          namespace,
                          name: backup.getName(),
                        })
                      }
                    >
                      <b>{backup.getName()}</b>
                    </DrawerLink>
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
      {schedules.map((schedule) => {
        const verdict = scheduleVerdict(schedule, clusters, index, now);

        return (
          <p key={schedule.getName()} className="CNPG-hint">
            Schedule{" "}
            <DrawerLink
              title="Opens the schedule"
              onClick={() =>
                followPage(onClose, open, "schedules", {
                  namespace,
                  name: schedule.getName(),
                })
              }
            >
              <b>{schedule.getName()}</b>
            </DrawerLink>{" "}
            (<code>{schedule.spec.schedule}</code>){" "}
            <Status tone={verdict.tone} label={verdict.label} />
          </p>
        );
      })}
    </section>
  );
}

export function PoolersSection({
  cluster,
  poolers,
  clusters,
  pods,
  onClose,
  open,
}: {
  cluster: ClusterLike;
  poolers: PoolerLike[];
  clusters: ClusterLike[];
  pods: PodLike[] | undefined;
  onClose: () => void;
  open: OpenPage;
}) {
  const own = poolersOf(cluster, poolers);
  const namespace = cluster.getNs();

  if (own.length === 0) return null;

  return (
    <section className="CNPG-section" data-section="cnpg-cluster-poolers">
      <h3 className="CNPG-section__title">Poolers</h3>
      <div className="CNPG-chips">
        {own.map((pooler) => (
          <span key={pooler.getName()} className="CNPG-chip">
            <DrawerLink
              title="Opens the pooler"
              onClick={() =>
                followPage(onClose, open, "poolers", {
                  namespace,
                  name: pooler.getName(),
                })
              }
            >
              {pooler.getName()}
            </DrawerLink>
            <span className="CNPG-chip__meta">
              {" "}
              {pooler.spec.type} · {poolerVerdict(pooler, clusters, pods).label}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

export function CertificatesSection({
  cluster,
  secrets,
  now,
  onClose,
}: {
  cluster: ClusterLike;
  secrets: SecretListings | undefined;
  now: number;
  onClose: () => void;
}) {
  const refusal = secretsRefusal(secrets, cluster.getNs());
  const views = tlsSecretsOf(cluster, secretsIn(secrets, cluster.getNs()));
  const expiries = certificateExpiries(cluster, now);

  return (
    <section className="CNPG-section" data-section="cnpg-certificates">
      <h3 className="CNPG-section__title">Certificates</h3>
      {refusal && <p className="CNPG-section__note">{refusal}</p>}
      {views.length > 0 && (
        <dl className="CNPG-facts">
          {views.map((view) => (
            <div key={view.role} style={{ display: "contents" }}>
              <dt>{view.role}</dt>
              <dd>
                Secret{" "}
                <DrawerLink
                  title={HOST_LIST_TITLES.Secret}
                  onClick={() => followHost(onClose, "Secret", view.secret)}
                >
                  <span className="CNPG-mono">{view.secret}</span>
                </DrawerLink>
                <span className="CNPG-muted"> · {describeSource(view)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {expiries.length === 0 ? (
        <p className="CNPG-section__note">None reported yet.</p>
      ) : (
        <dl className="CNPG-facts">
          {expiries.map((expiry) => (
            <div key={expiry.secret} style={{ display: "contents" }}>
              <dt>{expiry.secret}</dt>
              <dd>
                <Status tone={expiry.tone} label={describeExpiry(expiry, now)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="CNPG-hint">The operator renews the ones it issued a week before they expire.</p>
    </section>
  );
}

export function WarningsSection({
  events,
  note,
  now,
}: {
  events: EventLike[];
  note: string | undefined;
  now: number;
}) {
  return (
    <section className="CNPG-section" data-section="cnpg-warnings">
      <h3 className="CNPG-section__title">Recent warnings</h3>
      {note && <p className="CNPG-section__note">{note}</p>}
      {events.length > 0 && (
        <div className="CNPG-list">
          {events.slice(0, SHOWN_WARNINGS).map((event) => (
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
  );
}
