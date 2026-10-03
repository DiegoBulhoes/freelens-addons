// Status is optional: ArgoCD fills it lazily, so a new Application has no health or sync yet.
import type { Renderer } from "@freelensapp/extensions";

export interface ArgoCDKubeObjectCRD extends Renderer.K8sApi.LensExtensionKubeObjectCRD {
  title: string;
}

export interface ApplicationSource {
  repoURL?: string;
  path?: string;
  targetRevision?: string;
  chart?: string;
  ref?: string;
  helm?: {
    valueFiles?: string[];
    values?: string;
    releaseName?: string;
    parameters?: { name?: string; value?: string }[];
  };
  kustomize?: {
    namePrefix?: string;
    nameSuffix?: string;
    images?: string[];
  };
  directory?: {
    recurse?: boolean;
  };
}

export interface ApplicationDestination {
  server?: string;
  name?: string;
  namespace?: string;
}

export interface SyncPolicy {
  automated?: {
    prune?: boolean;
    selfHeal?: boolean;
    allowEmpty?: boolean;
  };
  syncOptions?: string[];
  retry?: {
    limit?: number;
    backoff?: {
      duration?: string;
      factor?: number;
      maxDuration?: string;
    };
  };
}

export interface ApplicationSpec {
  project: string;
  destination: ApplicationDestination;
  /** Exactly one of `source` or `sources` is set; read via `Application.getSources`. */
  source?: ApplicationSource;
  sources?: ApplicationSource[];
  syncPolicy?: SyncPolicy;
  revisionHistoryLimit?: number;
}

export type HealthStatusCode =
  | "Healthy"
  | "Progressing"
  | "Degraded"
  | "Suspended"
  | "Missing"
  | "Unknown";

export type SyncStatusCode = "Synced" | "OutOfSync" | "Unknown";

export interface HealthStatus {
  status?: HealthStatusCode;
  message?: string;
  lastTransitionTime?: string;
}

export interface ResourceStatus {
  group?: string;
  version?: string;
  kind?: string;
  namespace?: string;
  name?: string;
  status?: SyncStatusCode;
  health?: HealthStatus;
  hook?: boolean;
  requiresPruning?: boolean;
  syncWave?: number;
}

export interface SyncStatus {
  status?: SyncStatusCode;
  revision?: string;
  revisions?: string[];
  comparedTo?: {
    destination?: ApplicationDestination;
    source?: ApplicationSource;
    sources?: ApplicationSource[];
  };
}

export interface OperationState {
  phase?: "Running" | "Succeeded" | "Failed" | "Error" | "Terminating";
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  operation?: {
    sync?: {
      revision?: string;
      revisions?: string[];
      prune?: boolean;
      dryRun?: boolean;
      syncOptions?: string[];
      syncStrategy?: SyncStrategy;
    };
    initiatedBy?: {
      username?: string;
      automated?: boolean;
    };
  };
  syncResult?: {
    revision?: string;
    revisions?: string[];
    resources?: {
      group?: string;
      version?: string;
      kind?: string;
      namespace?: string;
      name?: string;
      status?: string;
      message?: string;
      hookPhase?: string;
      syncPhase?: string;
    }[];
  };
}

export interface RevisionHistory {
  id?: number;
  revision?: string;
  revisions?: string[];
  deployedAt?: string;
  deployStartedAt?: string;
  initiatedBy?: {
    username?: string;
    automated?: boolean;
  };
  source?: ApplicationSource;
  sources?: ApplicationSource[];
}

export interface ApplicationCondition {
  type?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface ApplicationStatus {
  health?: HealthStatus;
  sync?: SyncStatus;
  resources?: ResourceStatus[];
  operationState?: OperationState;
  history?: RevisionHistory[];
  conditions?: ApplicationCondition[];
  reconciledAt?: string;
  summary?: {
    images?: string[];
    externalURLs?: string[];
  };
  sourceType?: string;
  sourceTypes?: string[];
  controllerNamespace?: string;
}

export interface ResourceGroupKind {
  group?: string;
  kind?: string;
}

export interface ProjectRole {
  name?: string;
  description?: string;
  policies?: string[];
  groups?: string[];
  jwtTokens?: { iat?: number; exp?: number; id?: string }[];
}

export interface SyncWindow {
  kind?: "allow" | "deny";
  schedule?: string;
  duration?: string;
  timeZone?: string;
  applications?: string[];
  namespaces?: string[];
  clusters?: string[];
  manualSync?: boolean;
  andOperator?: boolean;
  description?: string;
}

export interface AppProjectSpec {
  description?: string;
  sourceRepos?: string[];
  sourceNamespaces?: string[];
  destinations?: ApplicationDestination[];
  clusterResourceWhitelist?: ResourceGroupKind[];
  clusterResourceBlacklist?: ResourceGroupKind[];
  namespaceResourceWhitelist?: ResourceGroupKind[];
  namespaceResourceBlacklist?: ResourceGroupKind[];
  roles?: ProjectRole[];
  syncWindows?: SyncWindow[];
  signatureKeys?: { keyID?: string }[];
  orphanedResources?: {
    warn?: boolean;
    ignore?: ResourceGroupKind[];
  };
  permitOnlyProjectScopedClusters?: boolean;
}

export type AppProjectStatus = Record<string, unknown>;

/** `hook` is the default and runs hooks; `apply` skips them. */
export interface SyncStrategy {
  hook?: { force?: boolean };
  apply?: { force?: boolean };
}
