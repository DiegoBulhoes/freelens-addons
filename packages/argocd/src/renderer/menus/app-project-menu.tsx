import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import type { AppProject } from "../api/app-project";
import { type BulkOutcome, describeOutcome } from "../api/bulk";
import {
  applicationsOf,
  freezeProject,
  isFrozen,
  refreshProjectApplications,
  syncProjectApplications,
  unfreezeProject,
} from "../api/project-actions";

const {
  Component: { Checkbox, ConfirmDialog, Icon, MenuItem, Notifications },
} = Renderer;

export interface AppProjectMenuItemProps {
  object: AppProject;
  toolbar?: boolean;
}

const APPLICATIONS_PAGE = "applications";

function notifyOutcome(pastTenseVerb: string, outcome: BulkOutcome) {
  const sentence = describeOutcome(pastTenseVerb, outcome);

  if (outcome.failures.length === 0) Notifications.ok(sentence);
  else Notifications.error(sentence);
}

function BulkSyncConfirmation({
  project,
  count,
  state,
}: {
  project: AppProject;
  count: number;
  state: { prune: boolean };
}) {
  const [prune, setPrune] = useState(state.prune);

  return (
    <div>
      <p>
        Sync all <b>{count}</b> Application{count === 1 ? "" : "s"} in <b>{project.getName()}</b>?
      </p>
      <p style={{ opacity: 0.8 }}>
        Each one will have ArgoCD apply what is in git. This cannot be undone from here.
      </p>
      <Checkbox
        label="Prune: also delete resources that are no longer in git"
        value={prune}
        onChange={(value: boolean) => {
          state.prune = value;
          setPrune(value);
        }}
      />
    </div>
  );
}

export function AppProjectMenuItem({
  object,
  toolbar,
  extension,
}: AppProjectMenuItemProps & { extension: Renderer.LensExtension }) {
  const name = object.getName();
  const applications = applicationsOf(object);
  const frozen = isFrozen(object);

  const viewApplications = () => {
    void extension.navigate(APPLICATIONS_PAGE, { project: name });
  };

  const toggleFreeze = () => {
    ConfirmDialog.open({
      labelOk: frozen ? "Resume" : "Freeze",
      okButtonProps: frozen ? { primary: true } : { accent: true },
      message: frozen ? (
        <p>
          Resume deploys for <b>{name}</b>? ArgoCD will start reconciling its {applications.length}{" "}
          Application{applications.length === 1 ? "" : "s"} again.
        </p>
      ) : (
        <div>
          <p>
            Freeze deploys for <b>{name}</b>?
          </p>
          <p style={{ opacity: 0.8 }}>
            A deny sync window is added to the project, so ArgoCD stops syncing its{" "}
            {applications.length} Application{applications.length === 1 ? "" : "s"} , automated and
            manual alike, until it is resumed. Nothing already running is rolled back.
          </p>
        </div>
      ),
      ok: async () => {
        try {
          if (frozen) {
            await unfreezeProject(object);
            Notifications.ok(`Deploys resumed for ${name}.`);
          } else {
            await freezeProject(object);
            Notifications.ok(`Deploys frozen for ${name}. ArgoCD will not sync its Applications.`);
          }
        } catch (error) {
          Notifications.checkedError(error, `Could not change the sync window on ${name}`);
        }
      },
    });
  };

  const refreshAll = () => {
    ConfirmDialog.open({
      labelOk: "Refresh all",
      okButtonProps: { primary: true },
      message: (
        <p>
          Refresh all <b>{applications.length}</b> Application
          {applications.length === 1 ? "" : "s"} in <b>{name}</b>? ArgoCD re-compares them with git
          and applies nothing.
        </p>
      ),
      ok: async () => {
        try {
          notifyOutcome("Refreshed", await refreshProjectApplications(object));
        } catch (error) {
          Notifications.checkedError(error, `Could not refresh the Applications of ${name}`);
        }
      },
    });
  };

  const syncAll = () => {
    const state = { prune: false };

    ConfirmDialog.open({
      labelOk: "Sync all",
      okButtonProps: { accent: true },
      message: <BulkSyncConfirmation project={object} count={applications.length} state={state} />,
      ok: async () => {
        try {
          notifyOutcome("Synced", await syncProjectApplications(object, { prune: state.prune }));
        } catch (error) {
          Notifications.checkedError(error, `Could not sync the Applications of ${name}`);
        }
      },
    });
  };

  return (
    <>
      <MenuItem onClick={viewApplications}>
        <Icon material="list" interactive={toolbar} tooltip="Show this project's Applications" />
        <span className="title">Applications ({applications.length})</span>
      </MenuItem>

      <MenuItem onClick={toggleFreeze}>
        <Icon
          material={frozen ? "play_arrow" : "pause"}
          interactive={toolbar}
          tooltip={frozen ? "Remove the deny sync window" : "Stop ArgoCD syncing this project"}
        />
        <span className="title">{frozen ? "Resume deploys" : "Freeze deploys"}</span>
      </MenuItem>

      <MenuItem onClick={refreshAll}>
        <Icon material="refresh" interactive={toolbar} tooltip="Re-compare all with git" />
        <span className="title">Refresh all...</span>
      </MenuItem>

      <MenuItem onClick={syncAll}>
        <Icon material="sync" interactive={toolbar} tooltip="Apply git to all" />
        <span className="title">Sync all...</span>
      </MenuItem>
    </>
  );
}
