import { Renderer } from "@freelensapp/extensions";

import { Application, type ApplicationApi } from "./application";
import { ImageUpdater, type ImageUpdaterApi } from "./image-updater";
import {
  CONTROLLER_SELECTOR,
  controllerNamespace,
  type JsonPatchOperation,
} from "./image-updater-patches";
import { openPodLogs } from "./workloads";

function ruleApi() {
  return ImageUpdater.getApi<ImageUpdater, ImageUpdaterApi>();
}

function descriptorOf(object: { getName(): string; getNs(): string | undefined }) {
  return { name: object.getName(), namespace: object.getNs() };
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

async function findControllers() {
  const deployments =
    (await Renderer.K8sApi.deploymentApi.list({}, { labelSelector: CONTROLLER_SELECTOR })) ?? [];

  return deployments.map((deployment) => ({
    name: deployment.getName(),
    namespace: deployment.getNs() as string,
  }));
}

export async function findControllerNamespace(fallback: string): Promise<string> {
  try {
    return controllerNamespace(await findControllers(), fallback);
  } catch {
    return fallback;
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

export type ControllerLogsResult = "opened" | "no-pods";

export async function openControllerLogs(): Promise<ControllerLogsResult> {
  const pods =
    (await Renderer.K8sApi.podsApi.list({}, { labelSelector: CONTROLLER_SELECTOR })) ?? [];
  const running = pods.find((pod) => pod.getStatusPhase() === "Running") ?? pods[0];

  if (!running) return "no-pods";

  return openPodLogs(running as never) === "opened" ? "opened" : "no-pods";
}
