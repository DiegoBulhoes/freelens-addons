import { Application } from "../applications/application";
import { getParentOf } from "../applications/insights";
import { revisionsOfDeploy } from "../applications/revisions";
import type { RevisionHistory, SyncPolicy, SyncStrategy } from "../shared/types";

export const REFRESH_ANNOTATION = "argocd.argoproj.io/refresh";

export type RefreshMode = "normal" | "hard";

/** The controller removes this annotation once it has acted, so it is normally absent. */
export function refreshPatch(mode: RefreshMode) {
  return { metadata: { annotations: { [REFRESH_ANNOTATION]: mode } } };
}

export interface SyncChoice {
  prune: boolean;
  /** As `kubectl replace --force`: delete and recreate, skipping graceful deletion. */
  force?: boolean;
}

/** Force goes on the hook strategy, as ArgoCD's UI does; `apply.force` would skip hooks. */
export function syncPatch({ prune, force = false }: SyncChoice) {
  return {
    operation: {
      sync: force ? { prune, syncStrategy: { hook: { force: true } } } : { prune },
      initiatedBy: { username: "freelens" },
    },
  };
}

export function isRiskyChoice({ prune, force }: SyncChoice): boolean {
  return prune || Boolean(force);
}

export function wasForced(sync: { syncStrategy?: SyncStrategy } | undefined): boolean {
  return Boolean(sync?.syncStrategy?.hook?.force || sync?.syncStrategy?.apply?.force);
}

/** Set while ArgoCD holds a request; a second one would be dropped behind it. */
export function operationInProgress(application: Application): boolean {
  const phase = Application.getLastSyncPhase(application);

  return (
    Application.getOperation(application) !== undefined ||
    phase === "Running" ||
    phase === "Terminating"
  );
}

export function operationRefusal(application: Application): string | undefined {
  return operationInProgress(application)
    ? `${application.getName()} already has an operation running. Wait for it, or terminate it.`
    : undefined;
}

/** Terminate stops a running sync only; a terminating one is already stopping. */
export function isSyncRunning(application: Application): boolean {
  return Application.getLastSyncPhase(application) === "Running";
}

/** `current` is a fresh read, not the store: an operation started since must refuse. */
function requireIdle(current: Application | null | undefined, name: string): Application {
  if (!current) throw new Error(`${name} no longer exists.`);

  const refusal = operationRefusal(current);

  if (refusal) throw new Error(refusal);

  return current;
}

export function planSync(
  current: Application | null | undefined,
  name: string,
  choice: SyncChoice,
) {
  const read = requireIdle(current, name);

  return withResourceVersion(syncPatch(choice), read.getResourceVersion());
}

/** The one write a rollback sends, and whether it turns automated sync off as `current` has it. */
export function planRollback(
  current: Application | null | undefined,
  name: string,
  historyId: number,
) {
  const read = requireIdle(current, name);
  const deploy = deployOf(read, historyId);

  if (!deploy) {
    throw new Error(`Deploy #${historyId} of ${name} has no revision and source to go back to.`);
  }

  const autoSync = autoSyncOf(read);

  return {
    patch: withResourceVersion(rollbackPatch(deploy, { autoSync }), read.getResourceVersion()),
    autoSyncOff: autoSync !== undefined,
  };
}

export function planResumeAutoSync(current: Application | null | undefined, name: string) {
  const saved = current ? autoSyncToResume(current) : undefined;

  if (!current || !saved) {
    throw new Error(
      `${name} has no automated sync from a rollback to put back, or it was turned on since.`,
    );
  }

  return withResourceVersion(resumeAutoSyncPatch(saved), current.getResourceVersion());
}

/** The API server rejects the write with 409 if the object changed since it was read. */
export function withResourceVersion<Patch extends object>(
  patch: Patch,
  resourceVersion: string | undefined,
) {
  if (!resourceVersion) return patch;

  const { metadata } = patch as { metadata?: object };

  return { ...patch, metadata: { ...metadata, resourceVersion } };
}

/** argocd-server refuses a deploy recorded without its source: it would not know what to sync. */
export function isRollbackTarget(
  deploy: RevisionHistory | undefined,
): deploy is RevisionHistory & { id: number } {
  if (!deploy || typeof deploy.id !== "number" || revisionsOfDeploy(deploy).length === 0) {
    return false;
  }

  return (deploy.sources?.length ?? 0) > 0 || Boolean(deploy.source?.repoURL);
}

/** The deploys before the current one that a rollback can reach, newest first. */
export function rollbackTargetsOf(
  application: Application,
  max: number,
): (RevisionHistory & { id: number })[] {
  return [...(application.status?.history ?? [])]
    .reverse()
    .slice(1)
    .filter(isRollbackTarget)
    .slice(0, max);
}

export function deployOf(
  application: Application,
  historyId: number,
): (RevisionHistory & { id: number }) | undefined {
  const deploy = (application.status?.history ?? []).find((entry) => entry.id === historyId);

  return isRollbackTarget(deploy) ? deploy : undefined;
}

export type AutoSync = NonNullable<SyncPolicy["automated"]>;

/** Kept on the Application, so the automated block a rollback turned off can be put back later. */
export const AUTO_SYNC_BEFORE_ROLLBACK = "freelens-addons/auto-sync-before-rollback";

/** What a rollback has to turn off: left on, it deploys the newer revision straight back. */
export function autoSyncOf(application: Application): AutoSync | undefined {
  return Application.isAutoSynced(application) ? application.spec.syncPolicy?.automated : undefined;
}

/** As argocd-server's Rollback: without the deploy's own source(s), ArgoCD syncs the spec's. */
export function rollbackPatch(
  deploy: RevisionHistory & { id: number },
  { autoSync }: { autoSync: AutoSync | undefined },
) {
  const revisions = revisionsOfDeploy(deploy);
  const sync =
    deploy.sources && deploy.sources.length > 0
      ? { revisions, sources: deploy.sources }
      : { revision: revisions[0], source: deploy.source };

  return {
    // One write: auto-sync off, what it was, and the rollback land together or not at all.
    ...(autoSync
      ? {
          metadata: { annotations: { [AUTO_SYNC_BEFORE_ROLLBACK]: JSON.stringify(autoSync) } },
          ...disableAutoSyncPatch(),
        }
      : {}),
    operation: {
      sync,
      initiatedBy: { username: "freelens" },
      info: [{ name: "Reason", value: `Rollback to deploy #${deploy.id}` }],
    },
  };
}

export function disableAutoSyncPatch() {
  return { spec: { syncPolicy: { automated: null } } };
}

/** The automated block a rollback from here turned off, while nothing has turned it on since. */
export function autoSyncToResume(application: Application): AutoSync | undefined {
  if (application.spec.syncPolicy?.automated != null) return undefined;

  const saved = application.metadata.annotations?.[AUTO_SYNC_BEFORE_ROLLBACK];

  if (!saved) return undefined;

  try {
    const parsed: unknown = JSON.parse(saved);

    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AutoSync)
      : undefined;
  } catch {
    return undefined;
  }
}

export function resumeAutoSyncPatch(automated: AutoSync) {
  return {
    metadata: { annotations: { [AUTO_SYNC_BEFORE_ROLLBACK]: null } },
    spec: { syncPolicy: { automated } },
  };
}

/** " with prune and self-heal", or "" when it does neither. */
export function autoSyncExtras(automated: AutoSync): string {
  const extras = [automated.prune && "prune", automated.selfHeal && "self-heal"].filter(Boolean);

  return extras.length > 0 ? ` with ${extras.join(" and ")}` : "";
}

export function describeAutoSync(automated: AutoSync): string {
  return `automated sync${autoSyncExtras(automated)}`;
}

/** Who puts automated sync back once a rollback turns it off, which syncs the newer revision again. */
export function rollbackRevertedBy(
  application: Application,
  all: Application[],
): string | undefined {
  if (!autoSyncOf(application)) return undefined;

  const name = application.getName();
  const owner = Application.getApplicationSet(application);

  if (owner) {
    return `The ApplicationSet ${owner} generates ${name} and can put its automated sync back, which deploys the newer revision again. Turn automated sync off in its template, or have it ignore that field, first.`;
  }

  const parent = getParentOf(application, all);

  if (parent && autoSyncOf(parent)?.selfHeal) {
    return `Its parent ${parent.getName()} self-heals: it puts ${name}'s automated sync back from git, which deploys the newer revision again. Turn self-heal off on ${parent.getName()} first.`;
  }

  return undefined;
}

export function describeRollback(application: Application, all: Application[]) {
  const autoSync = autoSyncOf(application);

  return {
    detail: autoSync
      ? `This also turns off its ${describeAutoSync(autoSync)}, or it would deploy the newer revision again at once. Resume auto-sync, in the notification or the menu, puts it back as it was.`
      : "Its automated sync is off, so the rollback stays until someone syncs again.",
    warning: rollbackRevertedBy(application, all),
  };
}

/** As argocd-server's TerminateOperation: the operation stays; its phase tells the controller to stop. */
export function terminatePatch() {
  return { status: { operationState: { phase: "Terminating" } } };
}
