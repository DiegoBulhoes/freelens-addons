import type { Application } from "../applications/application";
import type { SyncWindow } from "../shared/types";
import { withResourceVersion } from "../writes/patches";
import { AppProject } from "./app-project";

export const FREEZE_DESCRIPTION = "Frozen from Freelens";

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

/** The frozen project an Application's sync would wait on, if any: ArgoCD accepts it and holds it. */
export function frozenProjectOf(
  application: Application,
  projects: AppProject[],
): string | undefined {
  const project = projects.find((each) => AppProject.governs(each, application));

  return project && isFrozen(project) ? project.getName() : undefined;
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

/** The freeze or resume write for the project as read, or undefined when it already is. */
export function syncWindowsPatch(current: AppProject, frozen: boolean) {
  const existing = AppProject.getSyncWindows(current);
  const syncWindows = windowsFor(existing, frozen);

  if (syncWindows === existing) return undefined;

  // A merge patch replaces the whole list, so a window added since the read would be lost.
  return withResourceVersion(
    // null drops the field, so a project frozen and resumed is left as it was, not with [].
    { spec: { syncWindows: syncWindows.length > 0 ? syncWindows : null } },
    current.getResourceVersion(),
  );
}
