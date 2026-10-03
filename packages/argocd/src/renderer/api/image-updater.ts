import { Renderer } from "@freelensapp/extensions";

import type { ArgoCDKubeObjectCRD } from "./types";

// Settings layer global → Application reference → image; every level is optional.
export interface CommonUpdateSettings {
  updateStrategy?: string;
  forceUpdate?: boolean;
  allowTags?: string;
  ignoreTags?: string[];
  platforms?: string[];
  pullSecret?: string;
}

export interface WriteBackConfig {
  method?: string;
  gitConfig?: {
    repository?: string;
    branch?: string;
    writeBackTarget?: string;
  };
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
}

export interface ImageConfig {
  alias: string;
  imageName: string;
  commonUpdateSettings?: CommonUpdateSettings;
  manifestTargets?: {
    helm?: { name?: string; tag?: string; spec?: string };
    kustomize?: { name?: string };
    plugin?: { name?: string; tag?: string; spec?: string };
  };
}

export interface ApplicationRef {
  namePattern: string;
  labelSelectors?: LabelSelector;
  useAnnotations?: boolean;
  commonUpdateSettings?: CommonUpdateSettings;
  writeBackConfig?: WriteBackConfig;
  images?: ImageConfig[];
}

// Required as the CRD schema requires them.
export interface ImageUpdaterSpec {
  commonUpdateSettings?: CommonUpdateSettings;
  writeBackConfig?: WriteBackConfig;
  applicationRefs: ApplicationRef[];
}

export interface RecentUpdate {
  alias: string;
  image: string;
  newVersion: string;
  applicationsUpdated: number;
  updatedAt: string;
  /** The only place the previous tag is kept. */
  message?: string;
}

export interface ImageUpdaterCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface ImageUpdaterStatus {
  observedGeneration?: number;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
  applicationsMatched?: number;
  imagesManaged?: number;
  /** Only the last cycle that updated anything. */
  recentUpdates?: RecentUpdate[];
  conditions?: ImageUpdaterCondition[];
}

export class ImageUpdater extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  ImageUpdaterStatus,
  ImageUpdaterSpec
> {
  static override readonly kind = "ImageUpdater";
  static override readonly namespaced = true;
  static override readonly apiBase =
    "/apis/argocd-image-updater.argoproj.io/v1alpha1/imageupdaters";

  static override readonly crd: ArgoCDKubeObjectCRD = {
    apiVersions: ["argocd-image-updater.argoproj.io/v1alpha1"],
    plural: "imageupdaters",
    singular: "imageupdater",
    shortNames: [],
    title: "ImageUpdaters",
  };

  static getCondition(object: ImageUpdater, type: string): ImageUpdaterCondition | undefined {
    return object.status?.conditions?.find((condition) => condition.type === type);
  }

  static getApplicationRefs(object: ImageUpdater): ApplicationRef[] {
    return object.spec.applicationRefs;
  }
}

export class ImageUpdaterApi extends Renderer.K8sApi.KubeApi<ImageUpdater> {}
export class ImageUpdaterStore extends Renderer.K8sApi.KubeObjectStore<
  ImageUpdater,
  ImageUpdaterApi
> {}
