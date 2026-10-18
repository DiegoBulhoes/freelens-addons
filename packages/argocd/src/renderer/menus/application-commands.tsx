import { Renderer } from "@freelensapp/extensions";
import { Application } from "../api/applications/application";
import { AppProject } from "../api/projects/app-project";
import { frozenProjectOf } from "../api/projects/freeze";
import { DIALOG_READ_TIMEOUT_MS, withTimeout } from "../api/shared/read-timeout";
import { describeMissingPods } from "../api/shared/workload-selection";
import { getApplicationPods, openPodLogs } from "../api/shared/workloads";
import {
  listApplications,
  refreshApplication,
  resumeAutoSync,
  rollbackApplication,
  syncApplication,
  terminateSync,
} from "../api/writes/actions";
import { describeRefresh } from "../api/writes/bulk";
import {
  autoSyncToResume,
  describeAutoSync,
  describeRollback,
  isRiskyChoice,
  type RefreshMode,
  type SyncChoice,
} from "../api/writes/patches";
import { confirmWrite, notifyDone } from "../components/confirm";
import { describeSyncChoice, SyncChoices } from "../components/sync-choices";

const {
  Component: { Notifications },
} = Renderer;

export function confirmAndRefresh(application: Application, mode: RefreshMode): void {
  const name = application.getName();
  const { question, detail, label } = describeRefresh([name], mode);

  confirmWrite({
    question,
    detail,
    label,
    destructive: false,
    ok: async () => {
      try {
        await refreshApplication(application, mode);
        notifyDone(
          `${mode === "hard" ? "Hard refresh" : "Refresh"} requested for ${name}: ArgoCD compares it with git again.`,
        );
      } catch (error) {
        Notifications.checkedError(error, `Could not refresh ${name}`);
      }
    },
  });
}

// Read when asked: the Applications page does not load the projects' store.
async function readProject(application: Application): Promise<AppProject | undefined> {
  try {
    // get() takes no signal, so a hung read is left behind rather than aborted.
    const project = await withTimeout(
      () =>
        AppProject.getApi().get({
          name: Application.getProject(application),
          namespace: Application.getControlPlaneNamespace(application),
        }),
      DIALOG_READ_TIMEOUT_MS,
    );

    return project ? (project as AppProject) : undefined;
  } catch {
    return undefined;
  }
}

/** The choice and the typed name reach `ok` through callbacks: ConfirmDialog copies its message's props. */
export async function confirmAndSync(application: Application): Promise<void> {
  const name = application.getName();
  const { total } = Application.getResourceRollup(application);
  let choice: SyncChoice = { prune: false, force: false };
  const project = await readProject(application);
  const frozen = frozenProjectOf(application, project ? [project] : []);
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
            : `Sync started for ${name}${describeSyncChoice(choice)}.`,
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

// Who manages it is read when asked: the menu's page may not hold every Application.
export async function confirmAndRollback(
  application: Application,
  historyId: number,
  revision: string,
): Promise<void> {
  const name = application.getName();
  const { detail, warning } = describeRollback(application, await listApplications());

  confirmWrite({
    question: (
      <>
        Roll <b>{name}</b> back to deploy <b>#{historyId}</b> ({revision})?
      </>
    ),
    detail,
    form: warning ? <p className="ArgoCD-text--warning">{warning}</p> : undefined,
    label: "Roll back",
    destructive: true,
    ok: async () => {
      try {
        const turnedOff = await rollbackApplication(application, historyId);
        const started = `Rollback of ${name} to deploy #${historyId} started`;

        if (!turnedOff) {
          notifyDone(`${started}.`);
          return;
        }

        notifyDone(`${started}, and its automated sync was turned off.`, {
          label: "Resume auto-sync",
          done: `Automated sync of ${name} is back as it was.`,
          failed: `Could not resume automated sync on ${name}`,
          run: () => resumeAutoSync(application),
        });
      } catch (error) {
        Notifications.checkedError(error, `Could not roll ${name} back`);
      }
    },
  });
}

export function confirmAndResumeAutoSync(application: Application): void {
  const name = application.getName();
  const saved = autoSyncToResume(application);

  if (!saved) return;

  confirmWrite({
    question: (
      <>
        Turn the {describeAutoSync(saved)} of <b>{name}</b> back on?
      </>
    ),
    detail:
      "It is put back as it was before the rollback, so ArgoCD deploys what git says now, replacing the rolled-back deploy.",
    label: "Resume auto-sync",
    destructive: false,
    ok: async () => {
      try {
        await resumeAutoSync(application);
        notifyDone(`Automated sync of ${name} is back as it was.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not resume automated sync on ${name}`);
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
    await navigator.clipboard.writeText(text);
    Notifications.ok(`${whatWasCopied} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy the ${whatWasCopied.toLowerCase()}`);
  }
}
