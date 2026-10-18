import { getAttentionItems } from "../overview/overview";
import { AppProject } from "../projects/app-project";
import { FREEZE_DESCRIPTION, isFrozen } from "../projects/freeze";
import type { DrawerState } from "../shared/drawer-state";
import type { LoadState } from "../shared/store-state";
import { plural } from "../shared/text";
import type { ResourceGroupKind, SyncWindow } from "../shared/types";
import { autoSyncExtras, autoSyncOf, autoSyncToResume, describeAutoSync } from "../writes/patches";
import { Application } from "./application";
import { getParentOf } from "./insights";

const ARGOCD_API = "/apis/argoproj.io/v1alpha1";

/** The Application drawer's banner: its worst finding, as the overview reports it. */
export function applicationState(application: Application, now: number): DrawerState | undefined {
  const [finding] = getAttentionItems([application], now);

  if (!finding) return undefined;

  return {
    tone: finding.severity,
    label: finding.headline,
    reason: finding.detail ?? finding.headline,
  };
}

export function describeAutoSyncState(application: Application): string {
  const on = autoSyncOf(application);

  if (on) return `on${autoSyncExtras(on)}`;

  const saved = autoSyncToResume(application);

  return saved
    ? `off since a rollback from Freelens; Resume auto-sync in the menu puts its ${describeAutoSync(saved)} back`
    : "off: drift stays until someone syncs";
}

/** The API path the host's details drawer opens it by. */
export function projectLinkOf(application: Application): string {
  const namespace = Application.getControlPlaneNamespace(application) ?? "argocd";

  return `${ARGOCD_API}/namespaces/${namespace}/appprojects/${Application.getProject(application)}`;
}

/** An ApplicationSet opens on our page, by name and namespace; a parent in the host's drawer. */
export type Manager =
  | { kind: "ApplicationSet"; name: string; namespace: string }
  | { kind: "Application"; name: string; link: string };

/** What creates or keeps it: its ApplicationSet, or the Application whose resources it is. */
export function managerOf(application: Application, all: Application[]): Manager | undefined {
  const applicationSet = Application.getApplicationSet(application);

  if (applicationSet) {
    return { kind: "ApplicationSet", name: applicationSet, namespace: application.getNs() ?? "" };
  }

  const parent = getParentOf(application, all);

  return parent
    ? { kind: "Application", name: parent.getName(), link: parent.selfLink }
    : undefined;
}

/** A count only once its list is read: a refused or pending list is empty, not none. */
export function knownCount(state: LoadState, count: number): number | undefined {
  return state === "ready" ? count : undefined;
}

export function projectState(project: AppProject, governed: number | undefined): DrawerState {
  const governedApplications =
    governed === undefined ? "Applications" : plural(governed, "Application");

  if (isFrozen(project)) {
    return {
      tone: "warning",
      label: "Deploys frozen",
      reason: `A deny sync window added from Freelens holds every sync of its ${governedApplications}, automated and manual, until it is resumed.`,
    };
  }

  const windows = AppProject.getSyncWindows(project).length;

  if (windows > 0) {
    return {
      tone: "info",
      label: "sync windows",
      reason: `${windows} sync window${windows === 1 ? " decides" : "s decide"} when its ${governedApplications} may sync.`,
    };
  }

  return {
    tone: "ok",
    label: "open",
    reason: `No sync window: its ${governedApplications} sync whenever ArgoCD needs to.`,
  };
}

export interface WindowRow {
  /** Windows have no name, and two may share every field. */
  key: string;
  kind: string;
  schedule: string;
  duration: string;
  appliesTo: string;
  manualSync: string;
  description: string;
  fromFreelens: boolean;
}

/** ArgoCD reads a window with no selector as matching nothing. */
function appliesTo(window: SyncWindow): string {
  const parts = [
    window.applications?.length ? `Applications ${window.applications.join(", ")}` : "",
    window.namespaces?.length ? `namespaces ${window.namespaces.join(", ")}` : "",
    window.clusters?.length ? `clusters ${window.clusters.join(", ")}` : "",
  ].filter(Boolean);

  return parts.length === 0 ? "nothing" : parts.join(window.andOperator ? " and " : " or ");
}

export function describeWindows(project: AppProject): WindowRow[] {
  return AppProject.getSyncWindows(project).map((window, index) => ({
    key: `${index}/${window.kind}/${window.schedule}`,
    kind: window.kind ?? "—",
    // ArgoCD reads the schedule in UTC unless the window names a zone.
    schedule: `${window.schedule ?? "—"} (${window.timeZone || "UTC"})`,
    duration: window.duration ?? "—",
    appliesTo: appliesTo(window),
    manualSync: window.manualSync ? "allowed" : "blocked",
    description: window.description ?? "",
    fromFreelens: window.description === FREEZE_DESCRIPTION,
  }));
}

export interface RoleRow {
  name: string;
  description: string;
  groups: string[];
  policies: number;
}

export function describeRoles(project: AppProject): RoleRow[] {
  return (project.spec.roles ?? []).map((role) => ({
    name: role.name ?? "(unnamed)",
    description: role.description ?? "",
    groups: role.groups ?? [],
    policies: role.policies?.length ?? 0,
  }));
}

function formatKind({ group, kind }: ResourceGroupKind): string {
  return group ? `${group}/${kind ?? "*"}` : (kind ?? "*");
}

/** Only the lists the project sets: an absent one falls back to ArgoCD's default. */
export function kindRules(project: AppProject): { label: string; kinds: string[] }[] {
  const { spec } = project;

  return (
    [
      ["Cluster kinds allowed", spec.clusterResourceWhitelist],
      ["Cluster kinds denied", spec.clusterResourceBlacklist],
      ["Namespaced kinds allowed", spec.namespaceResourceWhitelist],
      ["Namespaced kinds denied", spec.namespaceResourceBlacklist],
    ] as const
  )
    .filter(([, kinds]) => (kinds?.length ?? 0) > 0)
    .map(([label, kinds]) => ({ label, kinds: (kinds ?? []).map(formatKind) }));
}
