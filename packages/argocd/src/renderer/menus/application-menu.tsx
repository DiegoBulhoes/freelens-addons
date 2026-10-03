import { Renderer } from "@freelensapp/extensions";

import { isSyncRunning } from "../api/actions";
import type { Application } from "../api/application";
import { argocdCommand, describeForHandover, kubectlCommand } from "../api/cli";
import { idOf } from "../api/identity";
import { getCompareUrl } from "../api/insights";
import { isPinned, setPinned } from "../api/pins";
import { revisionsOfDeploy, shortenRevision } from "../api/revisions";
import { notifyDone } from "../components/confirm";
import {
  confirmAndRollback,
  confirmAndSync,
  confirmAndTerminate,
  copyAndReport,
  openLogsAndReport,
  refreshAndReport,
} from "./application-commands";

const {
  Component: { Icon, MenuItem },
} = Renderer;

const MAX_ROLLBACK_TARGETS = 3;

/** Freelens does not export this props type. */
export interface ApplicationMenuItemProps {
  object: Application;
  /** Set in the details drawer toolbar, unset in the row menu. */
  toolbar?: boolean;
  onChanged?: () => void;
}

export function ApplicationMenuItem({ object, toolbar, onChanged }: ApplicationMenuItemProps) {
  const name = object.getName();
  const id = idOf(object);
  const pinned = isPinned(id);
  const compareUrl = getCompareUrl(object);
  const isSyncInFlight = isSyncRunning(object);

  const rollbackTargets = [...(object.status?.history ?? [])]
    .reverse()
    .slice(1, 1 + MAX_ROLLBACK_TARGETS);

  return (
    <>
      <MenuItem onClick={() => void openLogsAndReport(object)}>
        <Icon
          material="subject"
          interactive={toolbar}
          tooltip="Opens the logs of the Application's first pod"
        />
        <span className="title">Logs</span>
      </MenuItem>

      <MenuItem onClick={() => void refreshAndReport(object, "normal")}>
        <Icon
          material="refresh"
          interactive={toolbar}
          tooltip="Compares it with git again. Changes nothing in the cluster"
        />
        <span className="title">Refresh</span>
      </MenuItem>

      <MenuItem onClick={() => void refreshAndReport(object, "hard")}>
        <Icon
          material="layers_clear"
          interactive={toolbar}
          tooltip="Drops the cached manifests and generates them again. Changes nothing in the cluster"
        />
        <span className="title">Hard refresh</span>
      </MenuItem>

      <MenuItem onClick={() => confirmAndSync(object)}>
        <Icon
          material="sync"
          interactive={toolbar}
          tooltip="Applies what is in git. Asks first, with prune and force off"
        />
        <span className="title">Sync</span>
      </MenuItem>

      {isSyncInFlight && (
        <MenuItem onClick={() => confirmAndTerminate(object)}>
          <Icon
            material="stop_circle"
            interactive={toolbar}
            tooltip="Stops the sync in flight. What it applied stays"
          />
          <span className="title">Terminate sync</span>
        </MenuItem>
      )}

      {rollbackTargets.map((deploy) => {
        const revision = shortenRevision(revisionsOfDeploy(deploy)[0] ?? "?");

        return (
          <MenuItem
            key={deploy.id}
            onClick={() => confirmAndRollback(object, deploy.id ?? 0, revision)}
          >
            <Icon
              material="undo"
              interactive={toolbar}
              tooltip="Syncs this deploy's revision and turns automated sync off"
            />
            <span className="title">
              Roll back to #{deploy.id} ({revision})
            </span>
          </MenuItem>
        );
      })}

      {compareUrl && (
        <MenuItem onClick={() => window.open(compareUrl, "_blank", "noopener")}>
          <Icon
            material="difference"
            interactive={toolbar}
            tooltip="Opens the git diff since the previous deploy"
          />
          <span className="title">What changed in git</span>
        </MenuItem>
      )}

      <MenuItem onClick={() => void copyAndReport("Sync command", argocdCommand(object, "sync"))}>
        <Icon
          material="terminal"
          interactive={toolbar}
          tooltip="Copies the argocd app sync command"
        />
        <span className="title">Copy argocd sync command</span>
      </MenuItem>

      <MenuItem onClick={() => void copyAndReport("kubectl patch", kubectlCommand(object, "sync"))}>
        <Icon
          material="data_object"
          interactive={toolbar}
          tooltip="Copies the kubectl patch this extension sends to sync"
        />
        <span className="title">Copy kubectl sync patch</span>
      </MenuItem>

      <MenuItem onClick={() => void copyAndReport("Status summary", describeForHandover(object))}>
        <Icon
          material="summarize"
          interactive={toolbar}
          tooltip="Copies its sync, health and revision as text"
        />
        <span className="title">Copy status summary</span>
      </MenuItem>

      <MenuItem
        onClick={() => {
          const nowPinned = !pinned;

          setPinned(id, nowPinned);
          onChanged?.();
          notifyDone(nowPinned ? `Pinned ${name} to the top.` : `Unpinned ${name}.`, {
            done: nowPinned ? `Unpinned ${name}.` : `Pinned ${name} to the top again.`,
            failed: `Could not change the pin on ${name}`,
            run: async () => setPinned(id, !nowPinned),
          });
        }}
      >
        <Icon
          material={pinned ? "push_pin" : "vertical_align_top"}
          interactive={toolbar}
          tooltip={
            pinned
              ? "Lets it fall back to its place in the list"
              : "Keeps it at the top of the overview"
          }
        />
        <span className="title">{pinned ? "Unpin" : "Pin to the top"}</span>
      </MenuItem>
    </>
  );
}
