import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import {
  isHibernated,
  lastSwitchover,
  primaryRole,
  replicaNames,
  replicaSourceOf,
} from "../api/clusters/clusters";
import { connectionUrls, fullUrlCommand } from "../api/clusters/connection";
import { describeUptime, type Metrics, totalBytes } from "../api/clusters/metrics";
import type { SecretListings } from "../api/clusters/secret-metadata";
import { clusterEvents, upkeepIssues, warningsNote } from "../api/clusters/upkeep";
import type { ClusterRow } from "../api/overview/attention";
import {
  formatBytes,
  instanceKeys,
  primaryStatus,
  walPositionOf,
} from "../api/replication/replication";
import { CLUSTER_EFFECTS } from "../api/shared/effects";
import { HOST_LIST_TITLES } from "../api/shared/host-links";
import type { OpenPage } from "../api/shared/navigation";
import { indexInventory } from "../api/shared/rows";
import { kindNote } from "../api/shared/store-state";
import type { InstanceStatus } from "../api/shared/types";
import { withCause, worse } from "../api/shared/verdict";
import { clusterCommands } from "../api/writes/operations";
import { CommandsSection, copyText } from "../components/commands-section";
import { DrawerLink, followHost } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import type { CnpgStores } from "../hooks/use-cnpg-stores";
import { useInstanceStatuses } from "../hooks/use-instance-statuses";
import { useMetrics } from "../hooks/use-metrics";
import { useWarningEvents } from "../hooks/use-warning-events";
import {
  CertificatesSection,
  PoolersSection,
  RecentBackupsSection,
  VolumesSection,
  WarningsSection,
} from "./cluster-sections";
import {
  confirmBackup,
  confirmHibernate,
  confirmPromote,
  confirmReload,
  confirmRestart,
  confirmWake,
} from "./dialogs";
import {
  BudgetsSection,
  MaintenanceSection,
  ReplicationSlotsSection,
  RolesSection,
  TablespacesSection,
} from "./health-sections";
import { InstancesSection, openPsql } from "./instances-section";
import { LogSection } from "./log-section";

const {
  Component: { WithTooltip },
} = Renderer;

function stateOf(row: ClusterRow | undefined, cause: string | undefined, now: number) {
  if (!row) return undefined;

  const state = upkeepIssues(row.cluster, now).reduce(worse, worse(row.health, row.backup));

  return withCause(state, state === row.backup ? cause : undefined);
}

function ClusterFacts({
  row,
  statuses,
  metrics,
  now,
  onClose,
}: {
  row: ClusterRow;
  statuses: Record<string, InstanceStatus | undefined>;
  metrics: Metrics | undefined;
  now: number;
  onClose: () => void;
}) {
  const { cluster } = row;
  const source = replicaSourceOf(cluster);
  const replicas = replicaNames(cluster);
  const podLink = (name: string) => (
    <DrawerLink
      key={name}
      title={HOST_LIST_TITLES.Pod}
      onClick={() => followHost(onClose, "Pod", name)}
    >
      {name}
    </DrawerLink>
  );

  return (
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
      {source && (
        <>
          <dt>Replica of</dt>
          <dd>
            {source.name}
            {source.host && <span className="CNPG-muted"> · {source.host}</span>}
          </dd>
        </>
      )}
      <dt>{primaryRole(cluster)}</dt>
      <dd>{cluster.status?.currentPrimary ? podLink(cluster.status.currentPrimary) : "—"}</dd>
      <dt>Replicas</dt>
      <dd>
        {replicas.length === 0
          ? "None"
          : replicas.flatMap((name, at) => [at > 0 ? ", " : "", podLink(name)])}
      </dd>
      <dt>Last switchover</dt>
      <dd>{lastSwitchover(cluster) ?? "None since it was created"}</dd>
      <dt>Recoverable since</dt>
      <dd>{row.recoverableFrom ?? "—"}</dd>
      <dt>System ID</dt>
      <dd className="CNPG-mono">{cluster.status?.systemID ?? "—"}</dd>
      <dt>WAL position</dt>
      <dd className="CNPG-mono">{walPositionOf(primaryStatus(cluster, statuses)) ?? "—"}</dd>
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
      {connectionUrls(cluster).map(({ label, url }) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>
            <span className="CNPG-copyable">
              <code className="CNPG-mono">{url}</code>
              <WithTooltip tooltip="Copies the URL, without the password; the command for the full one is under Look further">
                <button
                  type="button"
                  className="CNPG-button"
                  onClick={() => void copyText(`${label} URL`, url)}
                >
                  Copy
                </button>
              </WithTooltip>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface ClusterDrawerProps {
  row?: ClusterRow;
  /** By namespace; a namespace not listed says nothing of who issued a certificate. */
  secrets?: SecretListings;
  /** Barman's own error, read from its log. */
  cause?: string;
  inventory: CnpgStores;
  onClose: () => void;
  open: OpenPage;
}

export const ClusterDrawer = observer(
  ({ row, secrets, cause, inventory, onClose, open }: ClusterDrawerProps) => {
    const cluster = row?.cluster;
    const now = Date.now();
    const hibernated = cluster ? isHibernated(cluster) : false;
    const metrics = useMetrics(cluster && !hibernated ? cluster : undefined);
    const statuses = useInstanceStatuses(cluster && !hibernated ? instanceKeys(cluster) : []);
    const warnings = useWarningEvents(cluster?.getNs());
    const index = indexInventory(inventory);
    const backups = cluster ? index.backupsOf(cluster) : [];
    const schedules = cluster ? index.schedulesOf(cluster) : [];
    const events =
      cluster && warnings.events ? clusterEvents(warnings.events, cluster, backups) : [];
    const warningNote = warningsNote(warnings, cluster?.getNs(), events.length);

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
                  title: `Opens psql on the ${primaryRole(cluster).toLowerCase()}, in a terminal tab`,
                  onClick: () => void openPsql(cluster, cluster.status?.currentPrimary),
                },
                {
                  icon: "backup",
                  title: `${CLUSTER_EFFECTS.backup}. Asks first`,
                  onClick: () => confirmBackup(cluster),
                },
                {
                  icon: "sync",
                  title: `${CLUSTER_EFFECTS.reload}. Asks first`,
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
                      title: `${CLUSTER_EFFECTS.wake}. Asks first`,
                      onClick: () => confirmWake(cluster),
                    }
                  : {
                      icon: "bedtime",
                      title: `${CLUSTER_EFFECTS.hibernate}. Asks you to type its name`,
                      onClick: () => confirmHibernate(cluster),
                    },
                {
                  icon: "restart_alt",
                  title: `${CLUSTER_EFFECTS.restart}. Asks you to type its name`,
                  onClick: () => confirmRestart(cluster),
                },
              ]
            : []
        }
      >
        {cluster && row && (
          <>
            <ClusterFacts
              row={row}
              statuses={statuses}
              metrics={metrics}
              now={now}
              onClose={onClose}
            />

            <InstancesSection
              cluster={cluster}
              statuses={statuses}
              pods={inventory.pods ?? []}
              onClose={onClose}
            />

            <ReplicationSlotsSection primary={primaryStatus(cluster, statuses)} />

            <VolumesSection cluster={cluster} onClose={onClose} />

            <RecentBackupsSection
              cluster={cluster}
              backups={backups}
              schedules={schedules}
              clusters={inventory.clusters}
              index={index}
              now={now}
              onClose={onClose}
              open={open}
            />

            <PoolersSection
              cluster={cluster}
              poolers={inventory.poolers}
              clusters={inventory.clusters}
              pods={inventory.pods}
              onClose={onClose}
              open={open}
            />

            <CertificatesSection cluster={cluster} secrets={secrets} now={now} onClose={onClose} />

            <WarningsSection events={events} note={warningNote} now={now} />

            <RolesSection cluster={cluster} />

            <TablespacesSection cluster={cluster} />

            <BudgetsSection
              cluster={cluster}
              budgets={inventory.budgets}
              budgetsNote={kindNote(
                inventory.states.budgets,
                inventory.failures.budgets,
                cluster.getNs() ?? "",
                "budgets",
              )}
            />

            <MaintenanceSection cluster={cluster} />

            <LogSection cluster={cluster} />

            <CommandsSection
              section="cnpg-commands"
              commands={[
                ...clusterCommands(cluster),
                {
                  label: "The full app connection URL, with the password",
                  command: fullUrlCommand(cluster),
                },
              ]}
            />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
