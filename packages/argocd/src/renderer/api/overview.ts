import type { AppProject } from "./app-project";
import { Application } from "./application";
import { revisionsOfDeploy } from "./revisions";
import type { HealthStatusCode, RevisionHistory, SyncStatusCode } from "./types";

export type Severity = "critical" | "warning" | "info";

const SYNC_WAVE_ANNOTATION = "argocd.argoproj.io/sync-wave";

export function getSyncWave(application: Application): number | undefined {
  const raw = application
    .getAnnotations()
    .find((entry) => entry.startsWith(`${SYNC_WAVE_ANNOTATION}=`));

  if (!raw) return undefined;

  const value = Number.parseInt(raw.slice(SYNC_WAVE_ANNOTATION.length + 1), 10);

  return Number.isNaN(value) ? undefined : value;
}

export interface AttentionItem {
  application: Application;
  severity: Severity;
  headline: string;
  detail?: string;
  since?: string;
  wave?: number;
  drifting?: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const BROKEN_HEALTH: HealthStatusCode[] = ["Degraded", "Missing"];

type Finding = Omit<AttentionItem, "application" | "wave">;

type Diagnosis = (application: Application, now: number) => Finding | undefined;

export const STUCK_SYNC_MINUTES = 15;

/** Calibrated against the controller's own reconciliation period, which is minutes. */
export const STALE_RECONCILE_MINUTES = 30;

function hasBeenSilentFor(timestamp: string | undefined, minutes: number, now: number): boolean {
  if (!timestamp) return false;

  const happenedAt = Date.parse(timestamp);

  return !Number.isNaN(happenedAt) && now - happenedAt > minutes * 60_000;
}

function diagnoseBrokenHealth(application: Application): Finding | undefined {
  const health = Application.getHealthStatus(application);

  if (!BROKEN_HEALTH.includes(health)) return undefined;

  return {
    severity: "critical",
    headline: health,
    detail: Application.getHealthMessage(application),
    since: application.status?.health?.lastTransitionTime,
  };
}

/**
 * An Application ArgoCD cannot compare with git — a branch that does not exist,
 * a path that is not there — keeps its last health, and reports its sync as
 * Unknown. Nothing turns red. The condition is the only place it says so.
 */
const CONDITION_HEADLINES: Record<string, string> = {
  ComparisonError: "Git error",
  InvalidSpecError: "Invalid spec",
};

function diagnoseConditionError(application: Application): Finding | undefined {
  const condition = (application.status?.conditions ?? []).find(
    (each) => each.type !== undefined && Object.hasOwn(CONDITION_HEADLINES, each.type),
  );

  if (!condition?.type) return undefined;

  return {
    severity: "critical",
    headline: CONDITION_HEADLINES[condition.type] ?? condition.type,
    detail: condition.message,
    since: condition.lastTransitionTime,
  };
}

/** ArgoCD leaves a stuck sync in phase "Running" indefinitely; nothing else reports it. */
function diagnoseStuckSync(application: Application, now: number): Finding | undefined {
  const operation = application.status?.operationState;

  if (operation?.phase !== "Running") return undefined;
  if (!hasBeenSilentFor(operation.startedAt, STUCK_SYNC_MINUTES, now)) return undefined;

  return {
    severity: "critical",
    headline: "Sync stuck",
    detail: `running for over ${STUCK_SYNC_MINUTES} minutes`,
    since: operation.startedAt,
  };
}

function diagnoseAbandonedReconcile(application: Application, now: number): Finding | undefined {
  const reconciledAt = application.status?.reconciledAt;

  if (!hasBeenSilentFor(reconciledAt, STALE_RECONCILE_MINUTES, now)) return undefined;

  return {
    severity: "critical",
    headline: "Not reconciled",
    detail: `ArgoCD has not looked at it for over ${STALE_RECONCILE_MINUTES} minutes`,
    since: reconciledAt,
  };
}

function diagnoseFailedSync(application: Application): Finding | undefined {
  const operation = application.status?.operationState;

  if (operation?.phase !== "Failed" && operation?.phase !== "Error") return undefined;

  return {
    severity: "critical",
    headline: `Last sync ${operation.phase.toLowerCase()}`,
    detail: operation.message,
    since: operation.finishedAt,
  };
}

function listDriftingResources(application: Application): string[] {
  return Application.getManagedResources(application)
    .filter((resource) => resource.status === "OutOfSync")
    .map((resource) => `${resource.kind}/${resource.name}`);
}

function diagnoseDrift(application: Application): Finding | undefined {
  if (Application.getSyncStatus(application) !== "OutOfSync") return undefined;

  const { total, outOfSync } = Application.getResourceRollup(application);

  return {
    severity: "warning",
    headline: "OutOfSync",
    detail:
      outOfSync > 0 ? `${outOfSync} of ${total} resources differ from git` : "differs from git",
    since: application.status?.reconciledAt,
    drifting: listDriftingResources(application),
  };
}

function diagnoseTransientHealth(application: Application): Finding | undefined {
  const health = Application.getHealthStatus(application);

  if (health !== "Progressing" && health !== "Suspended") return undefined;

  return {
    severity: "info",
    headline: health,
    detail: health === "Progressing" ? Application.getHealthMessage(application) : undefined,
    since: application.status?.health?.lastTransitionTime,
  };
}

/** Order is precedence: the first diagnosis that answers is the one reported. */
const DIAGNOSES: Diagnosis[] = [
  diagnoseBrokenHealth,
  diagnoseConditionError,
  diagnoseStuckSync,
  diagnoseAbandonedReconcile,
  diagnoseFailedSync,
  diagnoseDrift,
  diagnoseTransientHealth,
];

function diagnoseApplication(
  application: Application,
  now = Date.now(),
): AttentionItem | undefined {
  for (const diagnose of DIAGNOSES) {
    const finding = diagnose(application, now);

    if (finding) return { application, wave: getSyncWave(application), ...finding };
  }

  return undefined;
}

function compareByUrgency(first: AttentionItem, second: AttentionItem): number {
  const bySeverity = SEVERITY_ORDER[first.severity] - SEVERITY_ORDER[second.severity];

  if (bySeverity !== 0) return bySeverity;

  const firstWave = first.wave ?? Number.MAX_SAFE_INTEGER;
  const secondWave = second.wave ?? Number.MAX_SAFE_INTEGER;

  if (firstWave !== secondWave) return firstWave - secondWave;

  return first.application.getName().localeCompare(second.application.getName());
}

export function getAttentionItems(applications: Application[], now = Date.now()): AttentionItem[] {
  return applications
    .map((application) => diagnoseApplication(application, now))
    .filter((item): item is AttentionItem => item !== undefined)
    .sort(compareByUrgency);
}

export interface Counts {
  applications: number;
  projects: number;
  sync: Record<SyncStatusCode, number>;
  health: Record<HealthStatusCode, number>;
  manualOnly: number;
}

export function getCounts(applications: Application[], projects: AppProject[]): Counts {
  const counts: Counts = {
    applications: applications.length,
    projects: projects.length,
    sync: { Synced: 0, OutOfSync: 0, Unknown: 0 },
    health: {
      Healthy: 0,
      Progressing: 0,
      Degraded: 0,
      Suspended: 0,
      Missing: 0,
      Unknown: 0,
    },
    manualOnly: 0,
  };

  for (const application of applications) {
    counts.sync[Application.getSyncStatus(application)] += 1;
    counts.health[Application.getHealthStatus(application)] += 1;

    if (!Application.isAutoSynced(application)) counts.manualOnly += 1;
  }

  return counts;
}

export interface DeployEntry {
  application: Application;
  id: number | undefined;
  at: number;
  revisions: string[];
  by: string;
}

function deployInitiatorOf(deploy: RevisionHistory): string {
  if (deploy.initiatedBy?.automated) return "automated";

  return deploy.initiatedBy?.username ?? "unknown";
}

function deployedAtOf(deploy: RevisionHistory): number {
  return deploy.deployedAt ? Date.parse(deploy.deployedAt) : Number.NaN;
}

function toDeployEntry(application: Application, deploy: RevisionHistory): DeployEntry {
  return {
    application,
    id: deploy.id,
    at: deployedAtOf(deploy),
    revisions: revisionsOfDeploy(deploy),
    by: deployInitiatorOf(deploy),
  };
}

function compareByMostRecent(first: DeployEntry, second: DeployEntry): number {
  return second.at - first.at;
}

/** From `status.history`: Kubernetes events carry a TTL and are garbage collected. */
export function getRecentDeploys(applications: Application[], limit = 12): DeployEntry[] {
  return applications
    .flatMap((application) =>
      (application.status?.history ?? []).map((deploy) => toDeployEntry(application, deploy)),
    )
    .filter((entry) => !Number.isNaN(entry.at))
    .sort(compareByMostRecent)
    .slice(0, limit);
}

export interface RepeatedSync {
  application: Application;
  name: string;
  count: number;
  /** History is capped by revisionHistoryLimit, so the count can be a floor. */
  capped: boolean;
}

export function getRepeatedSyncs(
  applications: Application[],
  { withinMinutes = 60, threshold = 3, now = Date.now() } = {},
): RepeatedSync[] {
  const cutoff = now - withinMinutes * 60_000;
  const found: RepeatedSync[] = [];

  for (const application of applications) {
    const allDeploys = application.status?.history ?? [];
    const recentDeploys = allDeploys.filter((deploy) => {
      const deployedAt = deployedAtOf(deploy);

      return !Number.isNaN(deployedAt) && deployedAt >= cutoff;
    });

    if (recentDeploys.length < threshold) continue;

    found.push({
      application,
      name: application.getName(),
      count: recentDeploys.length,
      capped: recentDeploys.length === allDeploys.length,
    });
  }

  return found.sort((first, second) => second.count - first.count);
}
