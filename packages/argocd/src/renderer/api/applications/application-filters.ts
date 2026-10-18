import { AppProject } from "../projects/app-project";
import { Application } from "./application";

/** The Applications list's `status` filters; the overview's cards count with the same ones. */
export const STATUS_FILTERS = {
  synced: (application: Application) => Application.getSyncStatus(application) === "Synced",
  outofsync: (application: Application) => Application.getSyncStatus(application) === "OutOfSync",
  healthy: (application: Application) => Application.getHealthStatus(application) === "Healthy",
  degraded: (application: Application) =>
    Application.getHealthStatus(application) === "Degraded" ||
    Application.getHealthStatus(application) === "Missing",
  progressing: (application: Application) =>
    Application.getHealthStatus(application) === "Progressing",
  manual: (application: Application) => !Application.isAutoSynced(application),
} as const;

export type StatusFilter = keyof typeof STATUS_FILTERS;

export const STATUS_LABELS: Record<StatusFilter, string> = {
  synced: "synced",
  outofsync: "out of sync",
  healthy: "healthy",
  degraded: "degraded",
  progressing: "progressing",
  manual: "without auto-sync",
};

export function isStatusFilter(value: string | undefined): value is StatusFilter {
  return value !== undefined && Object.hasOwn(STATUS_FILTERS, value);
}

export interface ApplicationsQuery {
  project?: string;
  /** With `project`, names the one project of that name a link came from. */
  projectNamespace?: string;
  status?: string;
  name?: string;
  namespace?: string;
}

/** The project a link named; an older link without its namespace matches by name alone. */
export function governingProject(
  projects: AppProject[],
  query: ApplicationsQuery,
): AppProject | undefined {
  if (!query.project || !query.projectNamespace) return undefined;

  return projects.find(
    (project) => project.getName() === query.project && project.getNs() === query.projectNamespace,
  );
}

export function filterApplications(
  all: Application[],
  query: ApplicationsQuery,
  governing?: AppProject,
): Application[] {
  const { project, status, name, namespace } = query;
  const statusFilter = isStatusFilter(status) ? STATUS_FILTERS[status] : undefined;

  return all.filter((application) => {
    if (name && application.getName() !== name) return false;
    if (namespace && application.getNs() !== namespace) return false;
    if (governing) {
      if (!AppProject.governs(governing, application)) return false;
    } else if (project && Application.getProject(application) !== project) return false;
    if (statusFilter && !statusFilter(application)) return false;

    return true;
  });
}

/** The one Application a link named by namespace and name, whose drawer then opens. */
export function namedApplication(
  all: Application[],
  query: ApplicationsQuery,
): Application | undefined {
  if (!query.name || !query.namespace) return undefined;

  return filterApplications(all, { name: query.name, namespace: query.namespace })[0];
}

export function countByStatus(applications: Application[]): Record<StatusFilter, number> {
  const counts = Object.fromEntries(Object.keys(STATUS_FILTERS).map((key) => [key, 0])) as Record<
    StatusFilter,
    number
  >;

  for (const application of applications) {
    for (const key of Object.keys(STATUS_FILTERS) as StatusFilter[]) {
      if (STATUS_FILTERS[key](application)) counts[key] += 1;
    }
  }

  return counts;
}
