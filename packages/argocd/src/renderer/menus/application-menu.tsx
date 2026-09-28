import { Renderer } from "@freelensapp/extensions";

import { isSyncRunning } from "../api/actions";
import type { Application } from "../api/application";
import { argocdCommand, describeForHandover, kubectlCommand } from "../api/cli";
import { idOf } from "../api/identity";
import { getCompareUrl } from "../api/insights";
import { isPinned, togglePin } from "../api/pins";
import { revisionsOfDeploy, shortenRevision } from "../api/revisions";
import {
  confirmAndRollback,
  confirmAndSync,
  confirmAndTerminate,
  copyAndReport,
  openLogsAndReport,
  refreshAndReport,
} from "./application-commands";

const {
  Component: { Icon, MenuItem, Notifications },
} = Renderer;

const MAX_ROLLBACK_TARGETS = 3;

/** Freelens supplies these; it exports the registration type but not this props type. */
export interface ApplicationMenuItemProps {
  object: Application;
  /** Set when rendered in the details drawer toolbar rather than the row menu. */
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
        <Icon material="subject" interactive={toolbar} tooltip="Open the log viewer" />
        <span className="title">Logs</span>
      </MenuItem>

      <MenuItem onClick={() => void refreshAndReport(object, "normal")}>
        <Icon material="refresh" interactive={toolbar} tooltip="Refresh: re-compare with git" />
        <span className="title">Refresh</span>
      </MenuItem>

      <MenuItem onClick={() => void refreshAndReport(object, "hard")}>
        <Icon
          material="layers_clear"
          interactive={toolbar}
          tooltip="Hard refresh: drop the cached manifests and re-render them"
        />
        <span className="title">Hard Refresh</span>
      </MenuItem>

      <MenuItem onClick={() => confirmAndSync(object)}>
        <Icon material="sync" interactive={toolbar} tooltip="Sync: apply what is in git" />
        <span className="title">Sync...</span>
      </MenuItem>

      {isSyncInFlight && (
        <MenuItem onClick={() => confirmAndTerminate(object)}>
          <Icon material="stop_circle" interactive={toolbar} tooltip="Stop the sync in flight" />
          <span className="title">Terminate sync...</span>
        </MenuItem>
      )}

      {rollbackTargets.map((deploy) => {
        const revision = shortenRevision(revisionsOfDeploy(deploy)[0] ?? "?");

        return (
          <MenuItem
            key={deploy.id}
            onClick={() => confirmAndRollback(object, deploy.id ?? 0, revision)}
          >
            <Icon material="undo" interactive={toolbar} tooltip="Roll back to this deploy" />
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
            tooltip="What changed since the previous deploy"
          />
          <span className="title">What changed in git</span>
        </MenuItem>
      )}

      <MenuItem onClick={() => void copyAndReport("Sync command", argocdCommand(object, "sync"))}>
        <Icon
          material="terminal"
          interactive={toolbar}
          tooltip="Copy the argocd app sync command"
        />
        <span className="title">Copy argocd sync command</span>
      </MenuItem>

      <MenuItem onClick={() => void copyAndReport("kubectl patch", kubectlCommand(object, "sync"))}>
        <Icon
          material="data_object"
          interactive={toolbar}
          tooltip="Copy the kubectl patch this extension issues to sync"
        />
        <span className="title">Copy kubectl sync patch</span>
      </MenuItem>

      <MenuItem onClick={() => void copyAndReport("Status summary", describeForHandover(object))}>
        <Icon
          material="summarize"
          interactive={toolbar}
          tooltip="Copy a status summary: sync, health and revision"
        />
        <span className="title">Copy status summary</span>
      </MenuItem>

      <MenuItem
        onClick={() => {
          const nowPinned = togglePin(id);

          Notifications.ok(`${name} ${nowPinned ? "pinned" : "unpinned"}.`);
          onChanged?.();
        }}
      >
        <Icon
          material={pinned ? "push_pin" : "vertical_align_top"}
          interactive={toolbar}
          tooltip={pinned ? "Unpin it" : "Keep this one at the top"}
        />
        <span className="title">{pinned ? "Unpin" : "Pin to the top"}</span>
      </MenuItem>
    </>
  );
}
