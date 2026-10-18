import { Renderer } from "@freelensapp/extensions";

import { Application, type ApplicationApi } from "../applications/application";
import { ImageUpdater, type ImageUpdaterApi } from "../image-updater/image-updater";
import {
  CONTROLLER_SELECTOR,
  type ControllerRef,
  controllerOf,
} from "../image-updater/image-updater-controller";
import { descriptorOf } from "../shared/identity";
import { withTimeout } from "../shared/read-timeout";
import { pickRunningPod } from "../shared/workload-selection";
import { type OpenLogsResult, openPodLogs } from "../shared/workloads";
import type { JsonPatchOperation } from "./image-updater-patches";

function ruleApi() {
  return ImageUpdater.getApi<ImageUpdater, ImageUpdaterApi>();
}

export async function patchRule(updater: ImageUpdater, patch: JsonPatchOperation[]): Promise<void> {
  await ruleApi().patch(descriptorOf(updater), patch as never, "json");
}

export async function deleteRule(updater: ImageUpdater): Promise<void> {
  await ruleApi().delete(descriptorOf(updater) as never);
}

export async function patchApplication(
  application: Application,
  patch: JsonPatchOperation[],
): Promise<void> {
  await Application.getApi<Application, ApplicationApi>().patch(
    descriptorOf(application),
    patch as never,
    "json",
  );
}

async function findControllers(): Promise<ControllerRef[]> {
  const deployments =
    (await withTimeout((signal) =>
      Renderer.K8sApi.deploymentApi.list(
        { reqInit: { signal } },
        { labelSelector: CONTROLLER_SELECTOR },
      ),
    )) ?? [];

  return deployments.map((deployment) => ({
    name: deployment.getName(),
    namespace: deployment.getNs() as string,
  }));
}

export async function findController(fallbackNamespace: string): Promise<ControllerRef> {
  try {
    return controllerOf(await findControllers(), fallbackNamespace);
  } catch {
    return controllerOf([], fallbackNamespace);
  }
}

export type RestartResult = { restarted: string } | { notFound: true };

/** A new pod checks every rule at start; editing a rule's annotations does not wake the controller. */
export async function restartController(): Promise<RestartResult> {
  const [controller] = await findControllers();

  if (!controller) return { notFound: true };

  await Renderer.K8sApi.deploymentApi.restart(controller);

  return { restarted: `${controller.namespace}/${controller.name}` };
}

export async function openControllerLogs(): Promise<OpenLogsResult> {
  const pods =
    (await withTimeout((signal) =>
      Renderer.K8sApi.podsApi.list({ reqInit: { signal } }, { labelSelector: CONTROLLER_SELECTOR }),
    )) ?? [];
  const running = pickRunningPod(pods);

  if (!running) return "no-pods";

  return openPodLogs(running as never);
}
