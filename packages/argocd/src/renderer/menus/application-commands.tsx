import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import {
  type RefreshMode,
  refreshApplication,
  rollbackApplication,
  syncApplication,
  terminateSync,
} from "../api/actions";
import { Application } from "../api/application";
import { copyToClipboard } from "../api/cli";
import { describeMissingPods } from "../api/workload-selection";
import { getApplicationPods, openPodLogs } from "../api/workloads";

const {
  Component: { Checkbox, ConfirmDialog, Notifications },
} = Renderer;

interface PruneChoice {
  prune: boolean;
}

// The tick lives in a shared object, not React state: ConfirmDialog renders the message once and
// calls ok later, so ok cannot read a hook.
function SyncConfirmation({
  application,
  choice,
}: {
  application: Application;
  choice: PruneChoice;
}) {
  const [prune, setPrune] = useState(choice.prune);
  const { total } = Application.getResourceRollup(application);

  return (
    <div>
      <p>
        Sync <b>{application.getName()}</b> to <b>{Application.getDestination(application)}</b>?
      </p>
      <p className="ArgoCD-muted">
        ArgoCD will apply what is in git. {total} managed resource{total === 1 ? "" : "s"} may be
        affected.
      </p>
      <Checkbox
        label="Prune: also delete resources that are no longer in git"
        value={prune}
        onChange={(value: boolean) => {
          choice.prune = value;
          setPrune(value);
        }}
      />
    </div>
  );
}

/** Changes nothing in the cluster, which is why this one asks for no confirmation. */
export async function refreshAndReport(application: Application, mode: RefreshMode): Promise<void> {
  const name = application.getName();

  try {
    await refreshApplication(application, mode);
    Notifications.ok(
      `${mode === "hard" ? "Hard refresh" : "Refresh"} requested for ${name}. ArgoCD will re-compare it against git.`,
    );
  } catch (error) {
    Notifications.checkedError(error, `Could not refresh ${name}`);
  }
}

export function confirmAndSync(application: Application): void {
  const name = application.getName();
  const choice: PruneChoice = { prune: false };

  ConfirmDialog.open({
    labelOk: "Sync",
    okButtonProps: { primary: true },
    message: <SyncConfirmation application={application} choice={choice} />,
    ok: async () => {
      try {
        await syncApplication(application, { prune: choice.prune });
        Notifications.ok(
          `Sync started for ${name}${choice.prune ? " with prune" : ""}. Watch the Sync column for progress.`,
        );
      } catch (error) {
        Notifications.checkedError(error, `Could not start a sync for ${name}`);
      }
    },
  });
}

export async function openLogsAndReport(application: Application): Promise<void> {
  const name = application.getName();
  const { pods, listing } = await getApplicationPods(application);
  const firstPod = pods[0];

  if (!firstPod) {
    Notifications.error(describeMissingPods(name, listing));
    return;
  }

  if (openPodLogs(firstPod) === "no-pods") {
    Notifications.error(`${firstPod.getName()} has no containers to read logs from.`);
    return;
  }

  if (pods.length > 1) {
    Notifications.ok(`Opened logs for ${firstPod.getName()}. ${name} has ${pods.length} pods.`);
  }
}

export function confirmAndRollback(
  application: Application,
  historyId: number,
  revision: string,
): void {
  const name = application.getName();

  ConfirmDialog.open({
    labelOk: "Roll back",
    okButtonProps: { accent: true },
    message: (
      <div>
        <p>
          Roll <b>{name}</b> back to deploy <b>#{historyId}</b> ({revision})?
        </p>
        <p className="ArgoCD-muted">
          This also turns off automated sync. With it on, self-heal would put the newer revision
          back at once and the rollback would seem to do nothing. Turn it back on in git once the
          cause is fixed.
        </p>
      </div>
    ),
    ok: async () => {
      try {
        await rollbackApplication(application, historyId, { disableAutoSync: true });
        Notifications.ok(`Rolling ${name} back to deploy #${historyId}. Auto-sync is now off.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not roll ${name} back`);
      }
    },
  });
}

export function confirmAndTerminate(application: Application): void {
  const name = application.getName();

  ConfirmDialog.open({
    labelOk: "Terminate",
    okButtonProps: { accent: true },
    message: (
      <p>
        Terminate the running sync on <b>{name}</b>? Whatever ArgoCD already applied stays as it is.
      </p>
    ),
    ok: async () => {
      try {
        await terminateSync(application);
        Notifications.ok(`Sync terminated on ${name}.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not terminate the sync on ${name}`);
      }
    },
  });
}

export async function copyAndReport(whatWasCopied: string, text: string): Promise<void> {
  try {
    await copyToClipboard(text);
    Notifications.ok(`${whatWasCopied} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy the ${whatWasCopied.toLowerCase()}`);
  }
}
