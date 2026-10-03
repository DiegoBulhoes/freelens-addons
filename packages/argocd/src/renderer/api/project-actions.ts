import { AppProject, type AppProjectApi } from "./app-project";
import { Application } from "./application";
import { type BulkOutcome, refreshEach, syncEach } from "./bulk";
import { windowsFor } from "./patches";
import type { SyncWindow } from "./types";

export { isFrozen } from "./patches";

async function writeSyncWindows(project: AppProject, syncWindows: SyncWindow[]): Promise<void> {
  const api = AppProject.getApi<AppProject, AppProjectApi>();

  await api.patch(
    { name: project.getName(), namespace: project.getNs() },
    // A merge patch replaces the whole list.
    { spec: { syncWindows } },
    "merge",
  );
}

/** Reads the project as it is now: the notification's Undo runs after the first write changed it. */
export async function setFrozen(project: AppProject, frozen: boolean): Promise<void> {
  const api = AppProject.getApi<AppProject, AppProjectApi>();
  const current =
    (await api.get({ name: project.getName(), namespace: project.getNs() })) ?? project;
  const existing = AppProject.getSyncWindows(current);
  const next = windowsFor(existing, frozen);

  if (next === existing) return;

  await writeSyncWindows(current, next);
}

export function applicationsOf(project: AppProject): Application[] {
  const store = Application.getStore<Application>();

  return AppProject.selectApplications(project, store.items as Application[]);
}

export function refreshProjectApplications(project: AppProject): Promise<BulkOutcome> {
  return refreshEach(applicationsOf(project));
}

export function syncProjectApplications(
  project: AppProject,
  options: { prune: boolean; force?: boolean },
): Promise<BulkOutcome> {
  return syncEach(applicationsOf(project), options);
}
