import { Renderer } from "@freelensapp/extensions";
import { placementOf } from "../api/clusters/cluster-status";
import { instancesOf, isHibernated, replicaNames, roleLabel } from "../api/clusters/clusters";
import { clusterLags, instanceKey } from "../api/replication/replication";
import { HOST_LIST_TITLES } from "../api/shared/host-links";
import type { ClusterLike, InstanceStatus, PodLike } from "../api/shared/types";
import { openInstanceLog, openTerminal } from "../api/writes/actions";
import { psqlCommand, psqlRefusal } from "../api/writes/operations";
import { DrawerLink, followHost } from "../components/drawer-link";
import { Status } from "../components/status";
import {
  confirmDestroyInstance,
  confirmRestartInstance,
  confirmRestartReplicas,
  notifyRefusal,
} from "./dialogs";

const {
  Component: { Icon, MenuActions, MenuItem, Notifications, WithTooltip },
} = Renderer;

export async function openPsql(cluster: ClusterLike, instance: string | undefined) {
  if (notifyRefusal(psqlRefusal(cluster, instance))) return;

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

export function InstancesSection({
  cluster,
  statuses,
  pods,
  onClose,
}: {
  cluster: ClusterLike;
  statuses: Record<string, InstanceStatus | undefined>;
  pods: PodLike[];
  /** Closes the drawer before a link opens a host list. */
  onClose: () => void;
}) {
  const namespace = cluster.getNs();
  const instances = instancesOf(cluster);
  const lags = clusterLags(cluster, statuses);

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
            const { node, qos } = placementOf(pods, namespace, instance.name);
            const lag = lags.find((each) => each.replica === instance.name);
            const status = statuses[instanceKey(cluster, instance.name)];

            return (
              <div
                key={instance.name}
                className={`CNPG-row${instance.role === "primary" ? " CNPG-row--info" : ""}`}
              >
                <span className="CNPG-row__state">{roleLabel(cluster, instance.role)}</span>
                <span className="CNPG-row__main">
                  <span className="CNPG-row__name">
                    <DrawerLink
                      title={HOST_LIST_TITLES.Pod}
                      onClick={() => followHost(onClose, "Pod", instance.name)}
                    >
                      <b>{instance.name}</b>
                    </DrawerLink>
                    <span className="CNPG-row__meta">
                      {node && (
                        <DrawerLink
                          title={HOST_LIST_TITLES.Node}
                          onClick={() => followHost(onClose, "Node", node)}
                        >
                          {node}
                        </DrawerLink>
                      )}
                      {node && qos && " · "}
                      {qos}
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
                      // The menu renders outside the drawer. Prevented natively, the drawer ignores
                      // the click; the React event stays unprevented, so the menu still closes.
                      onClick={(event: { nativeEvent: Event }) => {
                        event.nativeEvent.preventDefault();
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
                      onClick={(event: { nativeEvent: Event }) => {
                        event.nativeEvent.preventDefault();
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
