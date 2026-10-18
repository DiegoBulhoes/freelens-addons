import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import {
  type BackupManifest,
  type BackupOptions,
  backupManifest,
  backupMethods,
} from "../api/backups/backup-manifests";
import { type Maintenance, maintenanceOf, maintenancePatch } from "../api/clusters/cluster-status";
import { healthyReplicaNames, replicaNames } from "../api/clusters/clusters";
import type { ClusterLike } from "../api/shared/types";
import {
  createBackup,
  destroyInstance,
  patchCluster,
  promote,
  restartInstance,
  restartReplicas,
} from "../api/writes/actions";
import {
  clusterActionRefusal,
  hibernationPatch,
  instanceRefusal,
  reloadPatch,
  restartPatch,
  restartReplicasRefusal,
} from "../api/writes/operations";
import { confirmWrite, notifyDone } from "../components/confirm";
import { BackupOptionsForm } from "./backup-form";
import { ChoiceButtons } from "./choice-buttons";

const {
  Component: { Notifications },
} = Renderer;

export function notifyRefusal(reason: string | undefined): boolean {
  if (reason) Notifications.error(reason);

  return Boolean(reason);
}

function notifyFailure(error: unknown, what: string) {
  Notifications.checkedError(error, `Could not ${what}`);
}

export async function startBackup(manifest: BackupManifest, cluster: string): Promise<void> {
  try {
    await createBackup(manifest);
    notifyDone(`Backup ${manifest.metadata.name} started for ${cluster}.`);
  } catch (error) {
    notifyFailure(error, `start a backup of ${cluster}`);
  }
}

export function confirmBackup(cluster: ClusterLike): void {
  if (notifyRefusal(clusterActionRefusal(cluster, "backup"))) return;

  const name = cluster.getName();
  let options: BackupOptions = { method: backupMethods(cluster)[0] };

  confirmWrite({
    question: (
      <>
        Back up <b>{name}</b> now?
      </>
    ),
    detail: "Creates a Backup, as kubectl cnpg backup does.",
    form: (
      <BackupOptionsForm
        methods={backupMethods(cluster)}
        onChange={(next) => {
          options = next;
        }}
      />
    ),
    label: "Back up",
    destructive: false,
    ok: async () => {
      const manifest = backupManifest(cluster, Date.now(), options);

      if (!manifest) return;

      await startBackup(manifest, name);
    },
  });
}

export function confirmRestart(cluster: ClusterLike): void {
  if (notifyRefusal(clusterActionRefusal(cluster, "restart"))) return;

  const name = cluster.getName();

  confirmWrite({
    question: (
      <>
        Restart <b>{name}</b>?
      </>
    ),
    detail:
      "Recreates every instance, replicas first, then switches over and recreates the old primary. Connections drop during the switchover.",
    label: "Restart",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await patchCluster(cluster, restartPatch(Date.now()));
        notifyDone(`Rolling restart requested for ${name}.`);
      } catch (error) {
        notifyFailure(error, `restart ${name}`);
      }
    },
  });
}

export function confirmReload(cluster: ClusterLike): void {
  if (notifyRefusal(clusterActionRefusal(cluster, "reload"))) return;

  const name = cluster.getName();

  confirmWrite({
    question: (
      <>
        Reload the configuration of <b>{name}</b>?
      </>
    ),
    detail: "Re-reads the configuration and certificates. Restarts nothing.",
    label: "Reload",
    destructive: false,
    ok: async () => {
      try {
        await patchCluster(cluster, reloadPatch(Date.now()));
        notifyDone(`Reload requested for ${name}.`);
      } catch (error) {
        notifyFailure(error, `reload ${name}`);
      }
    },
  });
}

function TargetForm({ replicas, onPick }: { replicas: string[]; onPick: (name: string) => void }) {
  const [picked, setPicked] = useState(replicas[0]);

  return (
    <div className="CNPG-form__field">
      <span>Replica to promote</span>
      <ChoiceButtons
        options={replicas.map((replica) => ({
          value: replica,
          label: replica,
          title: `Makes ${replica} the primary`,
        }))}
        value={picked}
        onPick={(replica) => {
          setPicked(replica);
          onPick(replica);
        }}
      />
    </div>
  );
}

export function confirmPromote(cluster: ClusterLike): void {
  if (notifyRefusal(clusterActionRefusal(cluster, "promote"))) return;

  const name = cluster.getName();
  const replicas = healthyReplicaNames(cluster);
  let target = replicas[0] ?? "";

  confirmWrite({
    question: (
      <>
        Switch <b>{name}</b> over to another primary?
      </>
    ),
    detail: `The primary ${cluster.status?.currentPrimary ?? ""} is demoted and restarted as a replica. Writes stop until the new primary is up.`,
    form: (
      <TargetForm
        replicas={replicas}
        onPick={(picked) => {
          target = picked;
        }}
      />
    ),
    label: "Switch over",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await promote(cluster, target);
        notifyDone(`Switchover of ${name} to ${target} started.`);
      } catch (error) {
        notifyFailure(error, `switch ${name} over`);
      }
    },
  });
}

async function setHibernation(cluster: ClusterLike, on: boolean) {
  await patchCluster(cluster, hibernationPatch(on));
}

export function confirmHibernate(cluster: ClusterLike): void {
  if (notifyRefusal(clusterActionRefusal(cluster, "hibernate"))) return;

  const name = cluster.getName();

  confirmWrite({
    question: (
      <>
        Hibernate <b>{name}</b>?
      </>
    ),
    detail:
      "Shuts Postgres down and deletes the pods. The volumes are kept, so waking it brings the data back.",
    label: "Hibernate",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await setHibernation(cluster, true);
        notifyDone(`Hibernation requested for ${name}.`, {
          label: "Wake",
          run: () => setHibernation(cluster, false),
        });
      } catch (error) {
        notifyFailure(error, `hibernate ${name}`);
      }
    },
  });
}

export function confirmWake(cluster: ClusterLike): void {
  if (notifyRefusal(clusterActionRefusal(cluster, "wake"))) return;

  const name = cluster.getName();

  confirmWrite({
    question: (
      <>
        Wake <b>{name}</b>?
      </>
    ),
    detail: "Recreates the pods on the kept volumes.",
    label: "Wake",
    destructive: false,
    ok: async () => {
      try {
        await setHibernation(cluster, false);
        notifyDone(`Wake requested for ${name}.`, {
          label: "Hibernate again",
          run: () => setHibernation(cluster, true),
        });
      } catch (error) {
        notifyFailure(error, `wake ${name}`);
      }
    },
  });
}

export function confirmRestartReplicas(cluster: ClusterLike): void {
  if (notifyRefusal(restartReplicasRefusal(cluster))) return;

  const name = cluster.getName();
  const replicas = replicaNames(cluster);

  confirmWrite({
    question: (
      <>
        Restart every replica of <b>{name}</b>?
      </>
    ),
    detail: `Deletes ${replicas.join(", then ")}, one at a time, waiting for each to be Ready again on its volume. The primary ${cluster.status?.currentPrimary ?? ""} is left alone.`,
    label: `Restart ${replicas.length}`,
    destructive: true,
    typed: () => name,
    ok: async () => {
      Notifications.info(
        `Restarting ${replicas.length} replica${replicas.length === 1 ? "" : "s"} of ${name}, one at a time.`,
      );

      try {
        await restartReplicas(cluster, replicas, (replica) =>
          Notifications.ok(`${replica} is back and Ready.`),
        );
        notifyDone(`Restarted every replica of ${name}.`);
      } catch (error) {
        notifyFailure(error, `restart every replica of ${name}`);
      }
    },
  });
}

export function confirmRestartInstance(cluster: ClusterLike, instance: string): void {
  if (notifyRefusal(instanceRefusal(cluster, instance, "restart"))) return;

  const primary = instance === cluster.status?.currentPrimary;

  confirmWrite({
    question: (
      <>
        Restart <b>{instance}</b>?
      </>
    ),
    detail: primary
      ? "It is the primary: Postgres restarts in place, without a switchover. Writes stop until it is back."
      : "Deletes its pod; the operator recreates it on the same volume.",
    label: "Restart",
    destructive: true,
    typed: () => instance,
    ok: async () => {
      try {
        await restartInstance(cluster, instance);
        notifyDone(`Restart of ${instance} requested.`);
      } catch (error) {
        notifyFailure(error, `restart ${instance}`);
      }
    },
  });
}

export function confirmDestroyInstance(cluster: ClusterLike, instance: string): void {
  if (notifyRefusal(instanceRefusal(cluster, instance, "destroy"))) return;

  confirmWrite({
    question: (
      <>
        Destroy <b>{instance}</b>?
      </>
    ),
    detail:
      "Deletes its pod, its jobs and its volumes, as kubectl cnpg destroy does. Its data is gone; the operator creates a new replica from the primary.",
    label: "Destroy",
    destructive: true,
    typed: () => instance,
    ok: async () => {
      try {
        await destroyInstance(cluster, instance);
        notifyDone(`Destroyed ${instance}. The operator will create a replacement.`);
      } catch (error) {
        notifyFailure(error, `destroy ${instance}`);
      }
    },
  });
}

function MaintenanceForm({
  initial,
  onChange,
}: {
  initial: Maintenance;
  onChange: (next: Maintenance) => void;
}) {
  const [reuse, setReuse] = useState(initial.reusePVC);

  return (
    <div className="CNPG-form__field">
      <span>When a node with an instance goes away</span>
      <ChoiceButtons
        options={[
          {
            value: true,
            label: "Wait and reuse its volume",
            title: "Keeps the volume and waits for the node to return",
          },
          {
            value: false,
            label: "Rebuild elsewhere",
            title: "Drops the volume and clones a new replica on another node",
          },
        ]}
        value={reuse}
        onPick={(value) => {
          setReuse(value);
          onChange({ ...initial, reusePVC: value });
        }}
      />
    </div>
  );
}

export function confirmMaintenance(cluster: ClusterLike): void {
  const name = cluster.getName();
  const current = maintenanceOf(cluster);
  let next: Maintenance = { ...current, inProgress: !current.inProgress };

  confirmWrite({
    question: (
      <>
        {current.inProgress ? "End" : "Start"} the node maintenance window of <b>{name}</b>?
      </>
    ),
    detail: current.inProgress
      ? "Node drains are treated as failures again."
      : "Lets a node with one of its instances be drained, as kubectl cnpg maintenance set does.",
    form: current.inProgress ? undefined : (
      <MaintenanceForm
        initial={next}
        onChange={(changed) => {
          next = changed;
        }}
      />
    ),
    label: current.inProgress ? "End" : "Start",
    destructive: false,
    ok: async () => {
      try {
        await patchCluster(cluster, maintenancePatch(next));
        notifyDone(`Maintenance window of ${name} ${next.inProgress ? "started" : "ended"}.`, {
          run: () => patchCluster(cluster, maintenancePatch(current)),
        });
      } catch (error) {
        notifyFailure(error, `change the maintenance window of ${name}`);
      }
    },
  });
}
