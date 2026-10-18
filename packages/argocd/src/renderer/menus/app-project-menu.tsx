import { Renderer } from "@freelensapp/extensions";

import type { AppProject } from "../api/projects/app-project";
import { isFrozen } from "../api/projects/freeze";
import { plural } from "../api/shared/text";
import { projectRefusal } from "../api/writes/bulk";
import type { SyncChoice } from "../api/writes/patches";
import {
  applicationsOf,
  refreshProjectApplications,
  setFrozen,
  syncProjectApplications,
} from "../api/writes/project-actions";
import { notifyBulkOutcome } from "../components/bulk";
import { confirmWrite, notifyDone } from "../components/confirm";
import { describeSyncChoice, SyncChoices } from "../components/sync-choices";
import { openProjectApplications } from "../pages/applications-page";

const {
  Component: { Icon, MenuItem, Notifications },
} = Renderer;

export interface AppProjectMenuItemProps {
  object: AppProject;
  toolbar?: boolean;
}

export function AppProjectMenuItem({
  object,
  toolbar,
  extension,
}: AppProjectMenuItemProps & { extension: Renderer.LensExtension }) {
  const name = object.getName();
  const applications = applicationsOf(object);
  const frozen = isFrozen(object);
  // A dialog that would refresh or sync nothing is not offered.
  const empty = projectRefusal("sync", () => applications.length)(object);

  const viewApplications = () => openProjectApplications(extension, object);

  const setFrozenAndReport = async (freeze: boolean) => {
    await setFrozen(object, freeze);
    notifyDone(
      freeze
        ? `Froze deploys for ${name}: ArgoCD stopped syncing its ${plural(applications.length, "Application")}.`
        : `Resumed deploys for ${name}.`,
      {
        done: freeze ? `Resumed deploys for ${name}.` : `Froze deploys for ${name} again.`,
        failed: `Could not change the sync window on ${name}`,
        run: () => setFrozen(object, !freeze),
      },
    );
  };

  const toggleFreeze = () => {
    confirmWrite({
      question: frozen ? (
        <>
          Resume deploys for <b>{name}</b>?
        </>
      ) : (
        <>
          Freeze deploys for <b>{name}</b>?
        </>
      ),
      detail: frozen
        ? `ArgoCD will start reconciling its ${plural(applications.length, "Application")} again.`
        : `A deny sync window is added to the project, so ArgoCD stops syncing its ${plural(applications.length, "Application")}, automated and manual alike, until it is resumed. Nothing already running is rolled back.`,
      label: frozen ? "Resume" : "Freeze",
      destructive: !frozen,
      ok: async () => {
        try {
          await setFrozenAndReport(!frozen);
        } catch (error) {
          Notifications.checkedError(error, `Could not change the sync window on ${name}`);
        }
      },
    });
  };

  const refreshAll = () => {
    confirmWrite({
      question: (
        <>
          Refresh all <b>{applications.length}</b> Application
          {applications.length === 1 ? "" : "s"} in <b>{name}</b>?
        </>
      ),
      detail: "ArgoCD compares them with git again and applies nothing.",
      label: `Refresh ${applications.length}`,
      destructive: false,
      ok: async () => {
        try {
          notifyBulkOutcome("Requested a refresh of", await refreshProjectApplications(object));
        } catch (error) {
          Notifications.checkedError(error, `Could not refresh the Applications of ${name}`);
        }
      },
    });
  };

  const syncAll = () => {
    let choice: SyncChoice = { prune: false, force: false };

    confirmWrite({
      question: (
        <>
          Sync all <b>{applications.length}</b> Application{applications.length === 1 ? "" : "s"} in{" "}
          <b>{name}</b>?
        </>
      ),
      detail: "Each one will have ArgoCD apply what is in git. This cannot be undone from here.",
      form: (
        <SyncChoices
          onChange={(picked) => {
            choice = picked;
          }}
        />
      ),
      label: `Sync ${applications.length}`,
      destructive: true,
      typed: () => "confirm",
      ok: async () => {
        try {
          notifyBulkOutcome(
            `Started a sync${describeSyncChoice(choice)} on`,
            await syncProjectApplications(object, choice),
          );
        } catch (error) {
          Notifications.checkedError(error, `Could not sync the Applications of ${name}`);
        }
      },
    });
  };

  return (
    <>
      <MenuItem onClick={viewApplications}>
        <Icon
          material="list"
          interactive={toolbar}
          tooltip="Opens the Applications list narrowed to this project"
        />
        <span className="title">Applications ({applications.length})</span>
      </MenuItem>

      <MenuItem onClick={toggleFreeze}>
        <Icon
          material={frozen ? "play_arrow" : "pause"}
          interactive={toolbar}
          tooltip={
            frozen
              ? "Removes the deny sync window, so ArgoCD syncs this project again"
              : "Adds a deny sync window, so ArgoCD stops syncing this project"
          }
        />
        <span className="title">{frozen ? "Resume deploys" : "Freeze deploys"}</span>
      </MenuItem>

      <MenuItem onClick={refreshAll} disabled={Boolean(empty)}>
        <Icon
          material="refresh"
          interactive={toolbar}
          tooltip={
            empty
              ? `Nothing to refresh: ${empty}`
              : "Compares every Application of the project with git again. Changes nothing in the cluster. Asks first"
          }
        />
        <span className="title">Refresh all</span>
      </MenuItem>

      <MenuItem onClick={syncAll} disabled={Boolean(empty)}>
        <Icon
          material="sync"
          interactive={toolbar}
          tooltip={
            empty
              ? `Nothing to sync: ${empty}`
              : "Applies git to every Application of the project. Asks you to type confirm"
          }
        />
        <span className="title">Sync all</span>
      </MenuItem>
    </>
  );
}
