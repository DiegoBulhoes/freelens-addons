import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { Application } from "../api/applications/application";
import {
  type ApplicationMenuEntry,
  applicationMenuEntries,
  rollbackTooltip,
} from "../api/applications/application-menu";
import { argocdCommand, describeForHandover, kubectlCommand } from "../api/applications/cli";
import { describeRevisions, revisionsOfDeploy } from "../api/applications/revisions";
import { isPinned, setPinned } from "../api/overview/pins";
import { idOf } from "../api/shared/identity";
import { notifyDone } from "../components/confirm";
import {
  confirmAndRefresh,
  confirmAndResumeAutoSync,
  confirmAndRollback,
  confirmAndSync,
  confirmAndTerminate,
  copyAndReport,
  openLogsAndReport,
} from "./application-commands";

const {
  Component: { Icon, MenuItem },
} = Renderer;

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

  const menuEntry = (
    key: string,
    material: string,
    tooltip: string,
    title: ReactNode,
    onClick: () => void,
  ) => (
    <MenuItem key={key} onClick={onClick}>
      <Icon material={material} interactive={toolbar} tooltip={tooltip} />
      <span className="title">{title}</span>
    </MenuItem>
  );

  const item = (entry: ApplicationMenuEntry) => {
    switch (entry.kind) {
      case "logs":
        return menuEntry(
          "logs",
          "subject",
          "Opens the logs of the Application's first pod",
          "Logs",
          () => void openLogsAndReport(object),
        );
      case "refresh":
        return menuEntry(
          "refresh",
          "refresh",
          "Compares it with git again. Changes nothing in the cluster. Asks first",
          "Refresh",
          () => confirmAndRefresh(object, "normal"),
        );
      case "hard-refresh":
        return menuEntry(
          "hard-refresh",
          "layers_clear",
          "Drops the cached manifests and generates them again. Changes nothing in the cluster. Asks first",
          "Hard refresh",
          () => confirmAndRefresh(object, "hard"),
        );
      case "compare":
        return menuEntry(
          "compare",
          "difference",
          "Opens the git diff since the previous deploy",
          "What changed in git",
          () => window.open(entry.url, "_blank", "noopener"),
        );
      case "copy-sync":
        return menuEntry(
          "copy-sync",
          "terminal",
          "Copies the argocd app sync command",
          "Copy argocd sync command",
          () => void copyAndReport("Sync command", argocdCommand(object, "sync")),
        );
      case "copy-patch":
        return menuEntry(
          "copy-patch",
          "data_object",
          "Copies the kubectl patch this extension sends to sync",
          "Copy kubectl sync patch",
          () => void copyAndReport("kubectl patch", kubectlCommand(object, "sync")),
        );
      case "copy-summary":
        return menuEntry(
          "copy-summary",
          "summarize",
          "Copies its sync, health and revision as text",
          "Copy status summary",
          () => void copyAndReport("Status summary", describeForHandover(object)),
        );
      case "pin":
        return menuEntry(
          "pin",
          pinned ? "push_pin" : "vertical_align_top",
          pinned
            ? "Lets it fall back to its place in the list"
            : "Keeps it at the top of the overview",
          pinned ? "Unpin" : "Pin to the top",
          () => {
            const nowPinned = !pinned;

            setPinned(id, nowPinned);
            onChanged?.();
            notifyDone(nowPinned ? `Pinned ${name} to the top.` : `Unpinned ${name}.`, {
              done: nowPinned ? `Unpinned ${name}.` : `Pinned ${name} to the top again.`,
              failed: `Could not change the pin on ${name}`,
              run: async () => setPinned(id, !nowPinned),
            });
          },
        );
      case "resume-auto-sync":
        return menuEntry(
          "resume-auto-sync",
          "play_arrow",
          "Turns automated sync back on as it was before the rollback. Asks first",
          "Resume auto-sync",
          () => confirmAndResumeAutoSync(object),
        );
      case "sync":
        return menuEntry(
          "sync",
          "sync",
          "Applies what is in git. Asks first, with prune and force off",
          "Sync",
          () => void confirmAndSync(object),
        );
      case "terminate":
        return menuEntry(
          "terminate",
          "stop_circle",
          "Stops the sync in flight. What it applied stays",
          "Terminate sync",
          () => confirmAndTerminate(object),
        );
      case "rollback": {
        const { deploy } = entry;
        const revision = describeRevisions(revisionsOfDeploy(deploy));

        return menuEntry(
          `rollback-${deploy.id}`,
          "undo",
          rollbackTooltip(object),
          <>
            Roll back to #{deploy.id} ({revision})
          </>,
          () => void confirmAndRollback(object, deploy.id, revision),
        );
      }
    }
  };

  return <>{applicationMenuEntries(object).map(item)}</>;
}
