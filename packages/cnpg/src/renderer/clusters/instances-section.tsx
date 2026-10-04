import { Renderer } from "@freelensapp/extensions";

import { openInstanceLog, openTerminal } from "../api/actions";
import { placementOf } from "../api/cluster-status";
import { instancesOf, isHibernated, replicaNames } from "../api/clusters";
import { psqlCommand, psqlRefusal } from "../api/operations";
import { replicaLags } from "../api/replication";
import type { ClusterLike, InstanceStatus, PodLike } from "../api/types";
import { Status } from "../components/status";
import { confirmDestroyInstance, confirmRestartInstance, confirmRestartReplicas } from "./dialogs";

const {
  Component: { Icon, MenuActions, MenuItem, Notifications, WithTooltip },
} = Renderer;

export async function openPsql(cluster: ClusterLike, instance: string | undefined) {
  const refused = psqlRefusal(cluster, instance);

  if (refused) {
    Notifications.error(refused);
    return;
  }

  if (!instance) return;

  try {
    await openTerminal(`psql ${instance}`, psqlCommand(cluster, instance));
  } catch (error) {
    Notifications.checkedError(error, `Could not open a terminal on ${instance}`);
  }
}

async function openLog(cluster: ClusterLike, instance: string) {
  try {
    if (!(await openInstanceLog(cluster, instance))) {
      Notifications.error(`No pod named ${instance} with a postgres container.`);
    }
  } catch (error) {
    Notifications.checkedError(error, `Could not open the log of ${instance}`);
  }
}

const ROLE_LABEL = { primary: "Primary", promoting: "Promoting", replica: "Replica" } as const;

export function InstancesSection({
  cluster,
  statuses,
  pods,
}: {
  cluster: ClusterLike;
  statuses: Record<string, InstanceStatus | undefined>;
  pods: PodLike[];
}) {
  const namespace = cluster.getNs();
  const instances = instancesOf(cluster);
  const lags = replicaLags(
    statuses[`${namespace}/${cluster.status?.currentPrimary}`],
    Object.fromEntries(instances.map((each) => [each.name, statuses[`${namespace}/${each.name}`]])),
  );

  return (
    <section className="CNPG-section" data-section="cnpg-instances">
      <div className="CNPG-section__bar">
        <h3 className="CNPG-section__title">Instances</h3>
        {replicaNames(cluster).length > 0 && (
          <WithTooltip tooltip="Restarts the replicas one at a time, leaving the primary alone. Asks you to type the cluster's name">
            <button
              type="button"
              className="CNPG-button CNPG-button--caution"
              onClick={() => confirmRestartReplicas(cluster)}
            >
              Restart replicas
            </button>
          </WithTooltip>
        )}
      </div>
      {instances.length === 0 ? (
        <p className="CNPG-section__note">
          {isHibernated(cluster) ? "None while hibernated." : "None reported yet."}
        </p>
      ) : (
        <div className="CNPG-list">
          {instances.map((instance) => {
            const placed = placementOf(pods, namespace, instance.name);
            const lag = lags.find((each) => each.replica === instance.name);
            const status = statuses[`${namespace}/${instance.name}`];

            return (
              <div
                key={instance.name}
                className={`CNPG-row${instance.role === "primary" ? " CNPG-row--info" : ""}`}
              >
                <span className="CNPG-row__state">{ROLE_LABEL[instance.role]}</span>
                <span className="CNPG-row__main">
                  <span className="CNPG-row__name">
                    <b>{instance.name}</b>
                    <span className="CNPG-row__meta">
                      {[placed.node, placed.qos].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="CNPG-row__reason">
                    <Status
                      tone={instance.healthy ? "ok" : "critical"}
                      label={instance.healthy ? "Healthy" : "Not healthy"}
                    />
                    {instance.timeline !== undefined && (
                      <span className="CNPG-muted"> · timeline {instance.timeline}</span>
                    )}
                    {lag && (
                      <span>
                        {" · "}
                        <Status tone={lag.verdict.tone} label={lag.verdict.label} />
                        <span className="CNPG-muted"> {lag.verdict.reason}</span>
                      </span>
                    )}
                    {status?.pendingRestart && (
                      <span className="CNPG-text--warning"> · Restart pending for a setting</span>
                    )}
                  </span>
                </span>
                <span className="CNPG-row__actions">
                  <WithTooltip tooltip={`Opens psql on ${instance.name}, in a terminal tab`}>
                    <button
                      type="button"
                      className="CNPG-button"
                      onClick={() => void openPsql(cluster, instance.name)}
                    >
                      psql
                    </button>
                  </WithTooltip>
                  <WithTooltip tooltip={`Opens the log of ${instance.name}'s postgres container`}>
                    <button
                      type="button"
                      className="CNPG-button"
                      onClick={() => void openLog(cluster, instance.name)}
                    >
                      Log
                    </button>
                  </WithTooltip>
                  <MenuActions toolbar={false} autoCloseOnSelect>
                    <MenuItem
                      // The menu renders outside the drawer; unprevented, this click would close it.
                      onClick={(event: { preventDefault(): void }) => {
                        event.preventDefault();
                        confirmRestartInstance(cluster, instance.name);
                      }}
                    >
                      <Icon
                        material="restart_alt"
                        tooltip={
                          instance.role === "primary"
                            ? "Restarts Postgres in place, without a switchover. Asks you to type its name"
                            : "Deletes its pod so the operator recreates it. Asks you to type its name"
                        }
                      />
                      <span className="title">Restart</span>
                    </MenuItem>
                    <MenuItem
                      onClick={(event: { preventDefault(): void }) => {
                        event.preventDefault();
                        confirmDestroyInstance(cluster, instance.name);
                      }}
                    >
                      <Icon
                        material="delete_forever"
                        tooltip="Deletes its pod and volumes; the operator builds a new replica. Asks you to type its name"
                      />
                      <span className="title">Destroy</span>
                    </MenuItem>
                  </MenuActions>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
