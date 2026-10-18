import { Application } from "../applications/application";
import { AppProject, type AppProjectApi } from "../projects/app-project";
import { syncWindowsPatch } from "../projects/freeze";
import { descriptorOf } from "../shared/identity";
import { type BulkOutcome, refreshEach, syncEach } from "./bulk";
import type { SyncChoice } from "./patches";

/** Reads the project as it is now: the notification's Undo runs after the first write changed it. */
export async function setFrozen(project: AppProject, frozen: boolean): Promise<void> {
  const api = AppProject.getApi<AppProject, AppProjectApi>();
  const current = (await api.get(descriptorOf(project))) ?? project;
  const patch = syncWindowsPatch(current, frozen);

  if (!patch) return;

  await api.patch(descriptorOf(current), patch as never, "merge");
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
  options: SyncChoice,
): Promise<BulkOutcome> {
  return syncEach(applicationsOf(project), options);
}
