import { Application, type ApplicationApi } from "../applications/application";
import { descriptorOf } from "../shared/identity";
import { DIALOG_READ_TIMEOUT_MS, withTimeout } from "../shared/read-timeout";
import {
  planResumeAutoSync,
  planRollback,
  planSync,
  type RefreshMode,
  refreshPatch,
  type SyncChoice,
  terminatePatch,
} from "./patches";

function applicationApi() {
  return Application.getApi<Application, ApplicationApi>();
}

export async function refreshApplication(
  application: Application,
  mode: RefreshMode = "normal",
): Promise<void> {
  await applicationApi().patch(descriptorOf(application), refreshPatch(mode), "merge");
}

function readCurrent(application: Application) {
  return applicationApi().get(descriptorOf(application));
}

export async function syncApplication(
  application: Application,
  options: SyncChoice,
): Promise<void> {
  const patch = planSync(await readCurrent(application), application.getName(), options);

  await applicationApi().patch(descriptorOf(application), patch as never, "merge");
}

/** Resolves to whether automated sync was turned off with it. */
export async function rollbackApplication(
  application: Application,
  historyId: number,
): Promise<boolean> {
  const plan = planRollback(await readCurrent(application), application.getName(), historyId);

  await applicationApi().patch(descriptorOf(application), plan.patch as never, "merge");

  return plan.autoSyncOff;
}

export async function resumeAutoSync(application: Application): Promise<void> {
  const patch = planResumeAutoSync(await readCurrent(application), application.getName());

  await applicationApi().patch(descriptorOf(application), patch as never, "merge");
}

/** For who manages an Application; refused or slow, a rollback asks without that warning. */
export async function listApplications(): Promise<Application[]> {
  try {
    const items = await withTimeout(
      (signal) => applicationApi().list({ reqInit: { signal } }),
      DIALOG_READ_TIMEOUT_MS,
    );

    return (items ?? []) as Application[];
  } catch {
    return [];
  }
}

export async function terminateSync(application: Application): Promise<void> {
  await applicationApi().patch(descriptorOf(application), terminatePatch() as never, "merge");
}
