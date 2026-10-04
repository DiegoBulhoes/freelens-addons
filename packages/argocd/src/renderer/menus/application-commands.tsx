import { Renderer } from "@freelensapp/extensions";

import {
  type RefreshMode,
  refreshApplication,
  rollbackApplication,
  syncApplication,
  terminateSync,
} from "../api/actions";
import { AppProject } from "../api/app-project";
import { Application } from "../api/application";
import { copyToClipboard } from "../api/cli";
import { frozenProjectOf, isRiskyChoice, type SyncChoice } from "../api/patches";
import { describeMissingPods } from "../api/workload-selection";
import { getApplicationPods, openPodLogs } from "../api/workloads";
import { confirmWrite, notifyDone } from "../components/confirm";
import { describeChoice, SyncChoices } from "../components/sync-choices";

const {
  Component: { Notifications },
} = Renderer;

/** No confirmation: a refresh changes nothing in the cluster. */
export async function refreshAndReport(application: Application, mode: RefreshMode): Promise<void> {
  const name = application.getName();

  try {
    await refreshApplication(application, mode);
    Notifications.ok(
      `${mode === "hard" ? "Hard refresh" : "Refresh"} requested for ${name}: ArgoCD compares it with git again.`,
    );
  } catch (error) {
    Notifications.checkedError(error, `Could not refresh ${name}`);
  }
}

// Read when asked: the Applications page does not load the projects' store.
async function projectOf(application: Application): Promise<AppProject[]> {
  try {
    const project = await AppProject.getApi().get({
      name: Application.getProject(application),
      namespace: application.getNs(),
    });

    return project ? [project as AppProject] : [];
  } catch {
    return [];
  }
}

/** The choice and the typed name reach `ok` through callbacks: ConfirmDialog copies its message's props. */
export async function confirmAndSync(application: Application): Promise<void> {
  const name = application.getName();
  const { total } = Application.getResourceRollup(application);
  let choice: SyncChoice = { prune: false, force: false };
  const frozen = frozenProjectOf(application, await projectOf(application));
  const held = frozen
    ? ` Its project ${frozen} is frozen: ArgoCD will hold the sync until it is resumed.`
    : "";

  confirmWrite({
    question: (
      <>
        Sync <b>{name}</b> to <b>{Application.getDestination(application)}</b>?
      </>
    ),
    detail: `ArgoCD will apply what is in git. ${total} managed resource${total === 1 ? "" : "s"} may be affected.${held}`,
    form: (onType) => (
      <SyncChoices
        typedName={name}
        onType={onType}
        onChange={(picked) => {
          choice = picked;
        }}
      />
    ),
    label: "Sync",
    destructive: false,
    typed: () => (isRiskyChoice(choice) ? name : undefined),
    ok: async () => {
      try {
        await syncApplication(application, choice);
        notifyDone(
          frozen
            ? `Sync of ${name} requested; it waits until ${frozen} is resumed.`
            : `Sync started for ${name}${describeChoice(choice)}.`,
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

  confirmWrite({
    question: (
      <>
        Roll <b>{name}</b> back to deploy <b>#{historyId}</b> ({revision})?
      </>
    ),
    detail:
      "This also turns off automated sync. With it on, self-heal would put the newer revision back at once and the rollback would seem to do nothing. Turn it back on in git once the cause is fixed.",
    label: "Roll back",
    destructive: true,
    ok: async () => {
      try {
        await rollbackApplication(application, historyId, { disableAutoSync: true });
        notifyDone(
          `Rollback of ${name} to deploy #${historyId} started, and its automated sync was turned off.`,
        );
      } catch (error) {
        Notifications.checkedError(error, `Could not roll ${name} back`);
      }
    },
  });
}

export function confirmAndTerminate(application: Application): void {
  const name = application.getName();

  confirmWrite({
    question: (
      <>
        Terminate the running sync on <b>{name}</b>?
      </>
    ),
    detail: "Whatever ArgoCD already applied stays as it is.",
    label: "Terminate",
    destructive: true,
    ok: async () => {
      try {
        await terminateSync(application);
        notifyDone(`Terminated the running sync on ${name}.`);
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
