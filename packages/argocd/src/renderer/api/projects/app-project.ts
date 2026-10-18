import { Renderer } from "@freelensapp/extensions";

import { Application } from "../applications/application";
import { shortenClusterUrl } from "../applications/destinations";
import { globMatches } from "../shared/glob";
import type {
  AppProjectSpec,
  AppProjectStatus,
  ArgoCDKubeObjectCRD,
  ResourceGroupKind,
} from "../shared/types";

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

  static getSourceNamespaces(object: AppProject): string[] {
    return object.spec.sourceNamespaces ?? [];
  }

  /** As ArgoCD's `IsAppNamespaceAllowed`: its namespace, or one its `sourceNamespaces` match. */
  static governs(object: AppProject, application: Application): boolean {
    if (Application.getProject(application) !== object.getName()) return false;

    const namespace = application.getNs();

    if (namespace === undefined) return false;
    if (namespace === object.getNs()) return true;

    return AppProject.getSourceNamespaces(object).some((pattern) =>
      namespaceMatches(pattern, namespace),
    );
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

  /** Two control planes can each have a project of the same name: the name alone is not enough. */
  static governedIn(object: AppProject, byProject: Map<string, Application[]>): Application[] {
    return (byProject.get(object.getName()) ?? []).filter((application) =>
      AppProject.governs(object, application),
    );
  }

  static selectApplications(object: AppProject, applications: Application[]): Application[] {
    return AppProject.governedIn(object, AppProject.groupApplicationsByProject(applications));
  }
}

/** ArgoCD's `MatchStringInList` (REGEXP): `/.../` is an unanchored regex, anything else a glob. */
export function namespaceMatches(pattern: string, namespace: string): boolean {
  if (pattern.length > 1 && pattern.startsWith("/") && pattern.endsWith("/")) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(namespace);
    } catch {
      return false;
    }
  }

  return globMatches(pattern, namespace);
}

export class AppProjectApi extends Renderer.K8sApi.KubeApi<AppProject> {}
export class AppProjectStore extends Renderer.K8sApi.KubeObjectStore<AppProject, AppProjectApi> {}
