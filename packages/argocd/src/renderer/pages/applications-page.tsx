import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { Application, type ApplicationApi } from "../api/application";
import { SelectionActions } from "../components/selection-actions";
import { HealthBadge, SyncBadge } from "../components/status";
import { ArgoCDStyles } from "../components/styles";
import { useKubeStore } from "../components/use-kube-store";

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

const sortingCallbacks = {
  name: (object: Application) => object.getName(),
  namespace: (object: Application) => object.getNs(),
  project: (object: Application) => Application.getProject(object),
  sync: (object: Application) => Application.getSyncStatus(object),
  health: (object: Application) => Application.getHealthStatus(object),
  drift: (object: Application) => Application.getResourceRollup(object).outOfSync,
  destination: (object: Application) => Application.getDestination(object),
  age: (object: Application) => object.getCreationTimestamp(),
};

const renderTableHeader = [
  { title: "Name", sortBy: "name" as const },
  { title: "Project", sortBy: "project" as const },
  { title: "Sync", sortBy: "sync" as const },
  { title: "Health", sortBy: "health" as const },
  { title: "Resources", sortBy: "drift" as const },
  { title: "Revision", sortBy: undefined },
  { title: "Destination", sortBy: "destination" as const },
  { title: "Age", sortBy: "age" as const },
];

function renderResources(object: Application) {
  const { total, outOfSync } = Application.getResourceRollup(object);

  if (total === 0) return <span style={{ opacity: 0.6 }}>none</span>;
  if (outOfSync === 0) return <span>{total} synced</span>;

  return (
    <span style={{ color: "var(--colorWarning)" }}>
      {outOfSync} of {total} drifting
    </span>
  );
}

function renderRevision(object: Application) {
  const revision = Application.getRevision(object);

  if (!revision) return <span style={{ opacity: 0.6 }}>—</span>;

  return (
    <WithTooltip>
      <code>{revision}</code>
      {Application.isMultiSource(object) && (
        <span style={{ opacity: 0.6, marginLeft: "0.4em" }}>(multi-source)</span>
      )}
    </WithTooltip>
  );
}

const STATUS_FILTERS: Record<string, (object: Application) => boolean> = {
  synced: (object) => Application.getSyncStatus(object) === "Synced",
  outofsync: (object) => Application.getSyncStatus(object) === "OutOfSync",
  healthy: (object) => Application.getHealthStatus(object) === "Healthy",
  degraded: (object) =>
    Application.getHealthStatus(object) === "Degraded" ||
    Application.getHealthStatus(object) === "Missing",
  progressing: (object) => Application.getHealthStatus(object) === "Progressing",
  manual: (object) => !Application.isAutoSynced(object),
};

const STATUS_LABELS: Record<string, string> = {
  synced: "synced",
  outofsync: "out of sync",
  healthy: "healthy",
  degraded: "degraded",
  progressing: "progressing",
  manual: "without auto-sync",
};

export interface ApplicationsPageProps {
  params?: {
    project: { get(): string };
    status: { get(): string };
    name: { get(): string };
  };
}

export const ApplicationsPage = observer(({ params }: ApplicationsPageProps) => {
  const store = useKubeStore(() => Application.getStore<Application>());
  const project = params?.project.get() ?? "";
  const status = params?.status.get() ?? "";
  const name = params?.name.get() ?? "";
  const statusFilter = STATUS_FILTERS[status];

  // getStore() throws until Freelens has registered the CRD's API.
  if (!store) return null;

  const all = store.items as Application[];
  const total = all.length;
  const filtered = all.filter((object) => {
    if (name && object.getName() !== name) return false;
    if (project && Application.getProject(object) !== project) return false;
    if (statusFilter && !statusFilter(object)) return false;

    return true;
  });

  return (
    <>
      {/* A host layout mounts none of our styles; the badges need them. */}
      <ArgoCDStyles />
      <KubeObjectListLayout<Application, ApplicationApi>
        tableId="argoCDApplicationsTable"
        className="ArgoCDApplications"
        store={store}
        sortingCallbacks={sortingCallbacks}
        searchFilters={[
          (object: Application) => object.getSearchFields(),
          (object: Application) => Application.getProject(object),
        ]}
        renderHeaderTitle={[
          "ArgoCD Applications",
          project && `project ${project}`,
          statusFilter && STATUS_LABELS[status],
        ]
          .filter(Boolean)
          .join(" · ")}
        // The host's count is of the whole store, not the filtered rows.
        customizeHeader={({ info }) => ({
          info: filtered.length === total ? info : `${filtered.length} of ${total}`,
        })}
        // Not filterCallbacks: they run only while a matching filter is active, so alone do nothing.
        getItems={() => filtered}
        renderTableHeader={renderTableHeader}
        renderFooter={(parent) => (
          <SelectionActions
            getItems={() => parent.items}
            pickOnlySelected={(items) => store.pickOnlySelected(items)}
          />
        )}
        renderTableContents={(object: Application) => [
          <WithTooltip key="name">{object.getName()}</WithTooltip>,
          <WithTooltip key="project">{Application.getProject(object)}</WithTooltip>,
          <SyncBadge
            key="sync"
            status={Application.getSyncStatus(object)}
            detail={Application.isAutoSynced(object) ? "automated sync policy" : "manual sync only"}
          />,
          <HealthBadge
            key="health"
            status={Application.getHealthStatus(object)}
            message={Application.getHealthMessage(object)}
          />,
          <span key="resources">{renderResources(object)}</span>,
          <span key="revision">{renderRevision(object)}</span>,
          <WithTooltip key="destination">{Application.getDestination(object)}</WithTooltip>,
          <KubeObjectAge object={object} key="age" />,
        ]}
      />
    </>
  );
});
