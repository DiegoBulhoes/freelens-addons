import { Renderer } from "@freelensapp/extensions";

import { Application } from "./application";
import { shortenClusterUrl } from "./destinations";
import type {
  AppProjectSpec,
  AppProjectStatus,
  ArgoCDKubeObjectCRD,
  ResourceGroupKind,
} from "./types";

// An absent list does not mean "nothing allowed": ArgoCD applies its own default per field.
export class AppProject extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  AppProjectStatus,
  AppProjectSpec
> {
  static override readonly kind = "AppProject";
  static override readonly namespaced = true;
  static override readonly apiBase = "/apis/argoproj.io/v1alpha1/appprojects";

  static override readonly crd: ArgoCDKubeObjectCRD = {
    apiVersions: ["argoproj.io/v1alpha1"],
    plural: "appprojects",
    singular: "appproject",
    shortNames: ["appproj", "appprojs"],
    title: "AppProjects",
  };

  static getDescription(object: AppProject): string | undefined {
    return object.spec.description;
  }

  static getSourceRepos(object: AppProject): string[] {
    return object.spec.sourceRepos ?? [];
  }

  static getDestinations(object: AppProject): string[] {
    return (object.spec.destinations ?? []).map((destination) => {
      const cluster = destination.name ?? shortenClusterUrl(destination.server) ?? "*";

      return `${cluster}/${destination.namespace ?? "*"}`;
    });
  }

  static getRoles(object: AppProject): string[] {
    return (object.spec.roles ?? []).map((role) => role.name ?? "(unnamed)");
  }

  static getSyncWindows(object: AppProject) {
    return object.spec.syncWindows ?? [];
  }

  static isUnrestricted(object: AppProject): boolean {
    const { spec } = object;

    const allowsEverything = (entries: ResourceGroupKind[] | undefined) =>
      entries?.length === 1 && entries[0]?.group === "*" && entries[0]?.kind === "*";

    return (
      spec.sourceRepos?.length === 1 &&
      spec.sourceRepos[0] === "*" &&
      spec.destinations?.length === 1 &&
      spec.destinations[0]?.server === "*" &&
      spec.destinations[0]?.namespace === "*" &&
      allowsEverything(spec.clusterResourceWhitelist) &&
      (spec.clusterResourceBlacklist?.length ?? 0) === 0 &&
      (spec.namespaceResourceBlacklist?.length ?? 0) === 0
    );
  }

  static groupApplicationsByProject(applications: Application[]): Map<string, Application[]> {
    const byProject = new Map<string, Application[]>();

    for (const application of applications) {
      const project = Application.getProject(application);
      const group = byProject.get(project);

      if (group) group.push(application);
      else byProject.set(project, [application]);
    }

    return byProject;
  }

  static selectApplications(object: AppProject, applications: Application[]): Application[] {
    return AppProject.groupApplicationsByProject(applications).get(object.getName()) ?? [];
  }
}

export class AppProjectApi extends Renderer.K8sApi.KubeApi<AppProject> {}
export class AppProjectStore extends Renderer.K8sApi.KubeObjectStore<AppProject, AppProjectApi> {}
