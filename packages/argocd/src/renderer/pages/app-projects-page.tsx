import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { observer } from "mobx-react";
import { useMemo } from "react";
import { Application } from "../api/applications/application";
import { AppProject, type AppProjectApi } from "../api/projects/app-project";
import { isFrozen } from "../api/projects/freeze";
import { plural } from "../api/shared/text";
import { RowDrawerLink } from "../components/drawer-link";
import { ProjectSelectionActions } from "../components/project-selection-actions";
import { Status } from "../components/status";
import { ArgoCDStyles } from "../components/styles";
import { useKubeStore } from "../components/use-kube-store";
import { openProjectApplications } from "./applications-page";

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

function sortingCallbacksFor(countApplications: (object: AppProject) => number) {
  return {
    name: (object: AppProject) => object.getName(),
    applications: countApplications,
    deploys: (object: AppProject) => (isFrozen(object) ? 0 : 1),
    repos: (object: AppProject) => AppProject.getSourceRepos(object).length,
    destinations: (object: AppProject) => AppProject.getDestinations(object).length,
    age: (object: AppProject) => object.getCreationTimestamp(),
  };
}

const renderTableHeader = [
  { title: "Name", sortBy: "name" as const },
  { title: "Applications", sortBy: "applications" as const },
  { title: "Deploys", sortBy: "deploys" as const },
  { title: "Source repos", sortBy: "repos" as const },
  { title: "Destinations", sortBy: "destinations" as const },
  { title: "Restrictions", sortBy: undefined },
  { title: "Age", sortBy: "age" as const },
];

function renderConstraint(values: string[]) {
  if (values.length === 0 || (values.length === 1 && (values[0] === "*" || values[0] === "*/*"))) {
    return <span style={{ opacity: 0.6 }}>any</span>;
  }
  if (values.length === 1) return <WithTooltip>{values[0]}</WithTooltip>;

  return <WithTooltip tooltip={values.join(", ")}>{`${values.length} entries`}</WithTooltip>;
}

function renderRestrictions(object: AppProject) {
  if (AppProject.isUnrestricted(object)) {
    return <span style={{ opacity: 0.6 }}>none, so everything is allowed</span>;
  }

  const parts: string[] = [];
  const { spec } = object;

  if (spec.clusterResourceBlacklist?.length) {
    parts.push(`${spec.clusterResourceBlacklist.length} cluster kinds denied`);
  }
  if (spec.namespaceResourceBlacklist?.length) {
    parts.push(`${spec.namespaceResourceBlacklist.length} namespaced kinds denied`);
  }

  const roles = AppProject.getRoles(object);
  if (roles.length > 0) parts.push(plural(roles.length, "role"));

  const windows = AppProject.getSyncWindows(object);
  if (windows.length > 0) parts.push(plural(windows.length, "sync window"));

  if (parts.length === 0) return <span style={{ opacity: 0.6 }}>scoped</span>;

  return <WithTooltip>{parts.join(", ")}</WithTooltip>;
}

export const AppProjectsPage = observer(({ extension }: { extension: Renderer.LensExtension }) => {
  const store = useKubeStore(() => AppProject.getStore<AppProject>());
  const applicationStore = useKubeStore(() => Application.getStore<Application>());

  // A computed, since `items` is mutated in place; read per row, not here, so a watch event does
  // not re-render the whole layout.
  const applicationsByProject = useMemo(
    () =>
      computed(() =>
        AppProject.groupApplicationsByProject((applicationStore?.items ?? []) as Application[]),
      ),
    [applicationStore],
  );

  if (!store) return null;

  const countApplications = (object: AppProject) =>
    AppProject.governedIn(object, applicationsByProject.get()).length;

  return (
    <>
      {/* A host layout mounts none of our styles; the status and the link need them. */}
      <ArgoCDStyles />
      <KubeObjectListLayout<AppProject, AppProjectApi>
        tableId="argoCDAppProjectsTable"
        className="ArgoCDAppProjects"
        store={store}
        // Without this the Applications store is unsubscribed here and every count reads 0.
        dependentStores={applicationStore ? [applicationStore] : []}
        sortingCallbacks={sortingCallbacksFor(countApplications)}
        searchFilters={[(object: AppProject) => object.getSearchFields()]}
        renderHeaderTitle="ArgoCD Projects"
        renderTableHeader={renderTableHeader}
        renderFooter={(parent) => (
          <ProjectSelectionActions
            getItems={() => parent.items}
            pickOnlySelected={(items) => store.pickOnlySelected(items)}
          />
        )}
        renderTableContents={(object: AppProject) => [
          <WithTooltip key="name">{object.getName()}</WithTooltip>,
          <RowDrawerLink
            key="applications"
            label={String(countApplications(object))}
            title="Opens the Applications list narrowed to this project"
            onOpen={() => openProjectApplications(extension, object)}
          />,
          isFrozen(object) ? (
            <Status
              key="deploys"
              tone="warning"
              label="Frozen"
              title="A deny sync window added from Freelens holds every sync until it is resumed"
            />
          ) : (
            <span key="deploys" className="ArgoCD-muted">
              allowed
            </span>
          ),
          <span key="repos">{renderConstraint(AppProject.getSourceRepos(object))}</span>,
          <span key="destinations">{renderConstraint(AppProject.getDestinations(object))}</span>,
          <span key="restrictions">{renderRestrictions(object)}</span>,
          <KubeObjectAge object={object} key="age" />,
        ]}
      />
    </>
  );
});
