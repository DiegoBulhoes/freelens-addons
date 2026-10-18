import { Renderer } from "@freelensapp/extensions";
import type {
  ApplicationSource,
  ApplicationSpec,
  ApplicationStatus,
  ArgoCDKubeObjectCRD,
  HealthStatusCode,
  Operation,
  ResourceStatus,
  SyncStatusCode,
} from "../shared/types";
import { formatDestination } from "./destinations";
import { describeRevisions, revisionsOfDeploy } from "./revisions";
import { sourcesOf } from "./sources";

// Every accessor tolerates `source` or `sources`, and a `status` not yet reconciled.
export class Application extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  ApplicationStatus,
  ApplicationSpec
> {
  static override readonly kind = "Application";
  static override readonly namespaced = true;
  static override readonly apiBase = "/apis/argoproj.io/v1alpha1/applications";

  static override readonly crd: ArgoCDKubeObjectCRD = {
    apiVersions: ["argoproj.io/v1alpha1"],
    plural: "applications",
    singular: "application",
    shortNames: ["app", "apps"],
    title: "Applications",
  };

  static getSources(object: Application): ApplicationSource[] {
    return sourcesOf(object.spec);
  }

  /** ArgoCD's HasMultipleSources: any `spec.sources` entry, even one, wins over `spec.source`. */
  static isMultiSource(object: Application): boolean {
    return (object.spec.sources?.length ?? 0) > 0;
  }

  static getProject(object: Application): string {
    return object.spec.project;
  }

  static getSyncStatus(object: Application): SyncStatusCode {
    return object.status?.sync?.status ?? "Unknown";
  }

  static getHealthStatus(object: Application): HealthStatusCode {
    return object.status?.health?.status ?? "Unknown";
  }

  static getHealthMessage(object: Application): string | undefined {
    return object.status?.health?.message;
  }

  static getRevision(object: Application): string | undefined {
    const revisions = revisionsOfDeploy(object.status?.sync);

    if (revisions.length === 0) return undefined;

    return describeRevisions(revisions);
  }

  static getDestination(object: Application): string {
    return formatDestination(object.spec.destination);
  }

  static getManagedResources(object: Application): ResourceStatus[] {
    return object.status?.resources ?? [];
  }

  static getResourceRollup(object: Application): {
    total: number;
    synced: number;
    outOfSync: number;
  } {
    const resources = Application.getManagedResources(object);
    let synced = 0;
    let outOfSync = 0;

    for (const resource of resources) {
      if (resource.status === "Synced") synced += 1;
      else if (resource.status === "OutOfSync") outOfSync += 1;
    }

    return { total: resources.length, synced, outOfSync };
  }

  static isAutoSynced(object: Application): boolean {
    const automated = object.spec.syncPolicy?.automated;

    return automated != null && automated.enabled !== false;
  }

  static getOperation(object: Application): Operation | undefined {
    return (object as unknown as { operation?: Operation | null }).operation ?? undefined;
  }

  /** Where its AppProject lives: the control plane's namespace, not always its own. */
  static getControlPlaneNamespace(object: Application): string | undefined {
    return object.status?.controllerNamespace || object.getNs();
  }

  /** The ApplicationSet that generates it, by its owner reference. */
  static getApplicationSet(object: Application): string | undefined {
    return object
      .getOwnerRefs()
      .find((ref) => ref.kind === "ApplicationSet" && ref.apiVersion.startsWith("argoproj.io/"))
      ?.name;
  }

  static getLastSyncPhase(object: Application): string | undefined {
    return object.status?.operationState?.phase;
  }

  static getImages(object: Application): string[] {
    return object.status?.summary?.images ?? [];
  }
}

export class ApplicationApi extends Renderer.K8sApi.KubeApi<Application> {}
export class ApplicationStore extends Renderer.K8sApi.KubeObjectStore<
  Application,
  ApplicationApi
> {}
