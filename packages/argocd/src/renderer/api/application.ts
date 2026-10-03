import { Renderer } from "@freelensapp/extensions";

import { shortenClusterUrl } from "./destinations";
import { revisionsOfDeploy, shortenRevision } from "./revisions";
import type {
  ApplicationSource,
  ApplicationSpec,
  ApplicationStatus,
  ArgoCDKubeObjectCRD,
  HealthStatusCode,
  ResourceStatus,
  SyncStatusCode,
} from "./types";

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
    const { source, sources } = object.spec;

    if (sources && sources.length > 0) return sources;
    if (source) return [source];

    return [];
  }

  static isMultiSource(object: Application): boolean {
    return (object.spec.sources?.length ?? 0) > 1;
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

    return revisions.map(shortenRevision).join(", ");
  }

  static getDestination(object: Application): string {
    const { destination } = object.spec;
    const cluster = destination.name ?? shortenClusterUrl(destination.server);
    const namespace = destination.namespace;

    if (cluster && namespace) return `${cluster}/${namespace}`;

    return cluster ?? namespace ?? "—";
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
    return object.spec.syncPolicy?.automated !== undefined;
  }

  static getLastSyncPhase(object: Application): string | undefined {
    return object.status?.operationState?.phase;
  }

  static getImages(object: Application): string[] {
    return object.status?.summary?.images ?? [];
  }
}

export { shortenRevision } from "./revisions";

export class ApplicationApi extends Renderer.K8sApi.KubeApi<Application> {}
export class ApplicationStore extends Renderer.K8sApi.KubeObjectStore<
  Application,
  ApplicationApi
> {}
