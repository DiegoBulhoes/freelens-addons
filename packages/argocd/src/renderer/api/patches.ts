import { AppProject } from "./app-project";
import type { Application } from "./application";
import { revisionsOfDeploy } from "./revisions";
import type { SyncStrategy, SyncWindow } from "./types";

export const REFRESH_ANNOTATION = "argocd.argoproj.io/refresh";

export type RefreshMode = "normal" | "hard";

export const FREEZE_DESCRIPTION = "Frozen from Freelens";

/** The controller removes this annotation once it has acted, so it is normally absent. */
export function refreshPatch(mode: RefreshMode) {
  return { metadata: { annotations: { [REFRESH_ANNOTATION]: mode } } };
}

export interface SyncChoice {
  prune: boolean;
  /** As `kubectl replace --force`: delete and recreate, skipping graceful deletion. */
  force?: boolean;
}

/** Force goes on the hook strategy, as ArgoCD's UI does; `apply.force` would skip hooks. */
export function syncPatch({ prune, force = false }: SyncChoice) {
  return {
    operation: {
      sync: force ? { prune, syncStrategy: { hook: { force: true } } } : { prune },
      initiatedBy: { username: "freelens" },
    },
  };
}

export function isRiskyChoice({ prune, force }: SyncChoice): boolean {
  return prune || Boolean(force);
}

export function wasForced(sync: { syncStrategy?: SyncStrategy } | undefined): boolean {
  return Boolean(sync?.syncStrategy?.hook?.force || sync?.syncStrategy?.apply?.force);
}

export function rollbackPatch(revision: string | undefined, historyId: number) {
  return {
    operation: {
      sync: { revision },
      initiatedBy: { username: "freelens" },
      info: [{ name: "Reason", value: `Rollback to deploy #${historyId}` }],
    },
  };
}

/** A rollback needs this first: self-heal would put the newer revision straight back. */
export function disableAutoSyncPatch() {
  return { spec: { syncPolicy: { automated: null } } };
}

/** Clearing `operation` is ArgoCD's terminate protocol; what it already applied stays. */
export function terminatePatch() {
  return { operation: null };
}

export function revisionOfHistory(application: Application, historyId: number): string | undefined {
  const deploy = (application.status?.history ?? []).find((entry) => entry.id === historyId);

  return revisionsOfDeploy(deploy)[0];
}

/** A `deny` window starting every minute and lasting a day is, in effect, always on. */
export const FREEZE_WINDOW: SyncWindow = {
  kind: "deny",
  schedule: "* * * * *",
  duration: "24h",
  applications: ["*"],
  manualSync: false,
  description: FREEZE_DESCRIPTION,
};

export function isFrozen(project: AppProject): boolean {
  return AppProject.getSyncWindows(project).some(
    (window) => window.description === FREEZE_DESCRIPTION,
  );
}

export function frozenWindows(existing: SyncWindow[]): SyncWindow[] {
  if (existing.some((window) => window.description === FREEZE_DESCRIPTION)) return existing;

  return [...existing, FREEZE_WINDOW];
}

export function thawedWindows(existing: SyncWindow[]): SyncWindow[] {
  return existing.filter((window) => window.description !== FREEZE_DESCRIPTION);
}

/** Starts from the project as it is now: an Undo runs after the first write changed it. */
export function windowsFor(existing: SyncWindow[], frozen: boolean): SyncWindow[] {
  return frozen ? frozenWindows(existing) : thawedWindows(existing);
}
