import { AppProject, type AppProjectApi } from "./app-project";
import { Application } from "./application";
import { type BulkOutcome, refreshEach, syncEach } from "./bulk";
import { frozenWindows, thawedWindows } from "./patches";
import type { SyncWindow } from "./types";

// A freeze is ArgoCD's own mechanism: a `deny` sync window that is always open stops the controller
// syncing anything belonging to the project.

export { isFrozen } from "./patches";

async function writeSyncWindows(project: AppProject, syncWindows: SyncWindow[]): Promise<void> {
  const api = AppProject.getApi<AppProject, AppProjectApi>();

  await api.patch(
    { name: project.getName(), namespace: project.getNs() },
    // A merge patch replaces the whole list, which is why the new one is computed from the current.
    { spec: { syncWindows } },
    "merge",
  );
}

export async function freezeProject(project: AppProject): Promise<void> {
  const existing = AppProject.getSyncWindows(project);
  const frozen = frozenWindows(existing);

  if (frozen === existing) return;

  await writeSyncWindows(project, frozen);
}

export async function unfreezeProject(project: AppProject): Promise<void> {
  await writeSyncWindows(project, thawedWindows(AppProject.getSyncWindows(project)));
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
  { prune }: { prune: boolean },
): Promise<BulkOutcome> {
  return syncEach(applicationsOf(project), { prune });
}
