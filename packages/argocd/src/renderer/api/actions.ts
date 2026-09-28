import { Application, type ApplicationApi } from "./application";
import {
  disableAutoSyncPatch,
  type RefreshMode,
  refreshPatch,
  revisionOfHistory,
  rollbackPatch,
  syncPatch,
  terminatePatch,
} from "./patches";

// Nothing here calls the ArgoCD API server: the controller watches its own resources, so a refresh
// is an annotation and a sync is a field, which is why the Kubernetes credentials alone suffice.

export type { RefreshMode } from "./patches";

export interface SyncOptions {
  /** Deletes resources that no longer exist in git. */
  prune: boolean;
}

function descriptorFor(application: Application) {
  return { name: application.getName(), namespace: application.getNs() };
}

function apiFor() {
  return Application.getApi<Application, ApplicationApi>();
}

export async function refreshApplication(
  application: Application,
  mode: RefreshMode = "normal",
): Promise<void> {
  await apiFor().patch(descriptorFor(application), refreshPatch(mode), "merge");
}

export async function syncApplication(
  application: Application,
  { prune }: SyncOptions,
): Promise<void> {
  await apiFor().patch(descriptorFor(application), syncPatch({ prune }) as never, "merge");
}

export async function rollbackApplication(
  application: Application,
  historyId: number,
  { disableAutoSync }: { disableAutoSync: boolean },
): Promise<void> {
  const api = apiFor();
  const descriptor = descriptorFor(application);

  if (disableAutoSync) {
    await api.patch(descriptor, disableAutoSyncPatch() as never, "merge");
  }

  await api.patch(
    descriptor,
    rollbackPatch(revisionOfHistory(application, historyId), historyId) as never,
    "merge",
  );
}

export async function terminateSync(application: Application): Promise<void> {
  await apiFor().patch(descriptorFor(application), terminatePatch() as never, "merge");
}

export function isSyncRunning(application: Application): boolean {
  return application.status?.operationState?.phase === "Running";
}
