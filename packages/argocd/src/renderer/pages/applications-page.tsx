import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useRef } from "react";
import { Application, type ApplicationApi } from "../api/applications/application";
import {
  filterApplications,
  governingProject,
  isStatusFilter,
  namedApplication,
  STATUS_LABELS,
} from "../api/applications/application-filters";
import { AppProject } from "../api/projects/app-project";
import { withinScope } from "../api/shared/namespace-scope";
import { showDetailsAfterClick } from "../api/shared/open-details";
import { SelectionActions } from "../components/selection-actions";
import { HealthBadge, SyncBadge } from "../components/status";
import { ArgoCDStyles } from "../components/styles";
import { useKubeStore } from "../components/use-kube-store";
import { useNamespaceScope } from "../hooks/use-namespace-scope";

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
  Navigation: { showDetails },
} = Renderer;

export const APPLICATIONS_PAGE = "applications";

export function openProjectApplications(extension: Renderer.LensExtension, project: AppProject) {
  void extension.navigate(APPLICATIONS_PAGE, {
    project: project.getName(),
    projectNamespace: project.getNs(),
  });
}

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

export interface ApplicationsPageProps {
  params?: {
    project: { get(): string };
    projectNamespace: { get(): string };
    status: { get(): string };
    name: { get(): string };
    namespace: { get(): string };
  };
}

export const ApplicationsPage = observer(({ params }: ApplicationsPageProps) => {
  const store = useKubeStore(() => Application.getStore<Application>());
  const projectStore = useKubeStore(() => AppProject.getStore<AppProject>());
  const scope = useNamespaceScope();
  const query = {
    project: params?.project.get() ?? "",
    projectNamespace: params?.projectNamespace.get() ?? "",
    status: params?.status.get() ?? "",
    name: params?.name.get() ?? "",
    namespace: params?.namespace.get() ?? "",
  };
  const all = withinScope((store?.items ?? []) as Application[], scope);
  const named = namedApplication(all, query);
  const opened = useRef<string>();

  // A link that names one Application opens its drawer, once, so it can still be closed.
  useEffect(() => {
    if (!named || opened.current === named.selfLink) return;

    return showDetailsAfterClick(named.selfLink, (link) => {
      opened.current = link;
      showDetails(link);
    });
  }, [named]);

  // getStore() throws until Freelens has registered the CRD's API.
  if (!store) return null;

  const total = all.length;
  const governing = governingProject((projectStore?.items ?? []) as AppProject[], query);
  const filtered = filterApplications(all, query, governing);
  const { project, status } = query;

  return (
    <>
      {/* A host layout mounts none of our styles; the badges need them. */}
      <ArgoCDStyles />
      <KubeObjectListLayout<Application, ApplicationApi>
        tableId="argoCDApplicationsTable"
        className="ArgoCDApplications"
        store={store}
        // A project's link counts by its rules, so the list needs the project itself.
        dependentStores={query.projectNamespace && projectStore ? [projectStore] : []}
        sortingCallbacks={sortingCallbacks}
        searchFilters={[
          (object: Application) => object.getSearchFields(),
          (object: Application) => Application.getProject(object),
        ]}
        renderHeaderTitle={[
          "ArgoCD Applications",
          project && `project ${project}`,
          isStatusFilter(status) && STATUS_LABELS[status],
        ]
          .filter(Boolean)
          .join(" · ")}
        // The host's count is of the whole store, not the filtered rows.
        // The whole header: a field left out is dropped, the namespace selector with it.
        customizeHeader={(header) => ({
          ...header,
          info: filtered.length === total ? header.info : `${filtered.length} of ${total}`,
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
