import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";

import { AppProject } from "./api/app-project";
import { Application } from "./api/application";
import { isInstalled } from "./api/installed";
import { flushState, startPersistingState } from "./api/persist";
import { ApplicationDetails } from "./details/application-details";
import { ArgoCDIcon } from "./icons/argocd";
import { AppProjectMenuItem } from "./menus/app-project-menu";
import { ApplicationMenuItem } from "./menus/application-menu";
import { AppProjectsPage } from "./pages/app-projects-page";
import { ApplicationsPage, type ApplicationsPageProps } from "./pages/applications-page";
import { DashboardPage } from "./pages/dashboard-page";

const PAGES = {
  dashboard: "dashboard",
  applications: "applications",
  projects: "projects",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
/**
 * The sidebar's own CRD list: the host keeps it loaded and watched while the
 * cluster is open, so the group appears and disappears with the operator,
 * without a reload. Until the list first arrives the group stays hidden.
 */
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class ArgoCDRenderer extends Renderer.LensExtension {
  override kubeObjectDetailItems = [
    {
      kind: Application.kind,
      apiVersions: Application.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<Application>) => (
          <ApplicationDetails {...props} />
        ),
      },
    },
  ];

  override kubeObjectMenuItems = [
    {
      kind: Application.kind,
      apiVersions: Application.crd.apiVersions,
      components: { MenuItem: ApplicationMenuItem },
    },
    {
      kind: AppProject.kind,
      apiVersions: AppProject.crd.apiVersions,
      components: {
        MenuItem: (props: { object: AppProject; toolbar?: boolean }) => (
          <AppProjectMenuItem {...props} extension={this} />
        ),
      },
    },
  ];

  override clusterPages = [
    {
      id: PAGES.dashboard,
      components: {
        Page: () => <DashboardPage extension={this} />,
      },
    },
    {
      id: PAGES.applications,
      params: { project: "", status: "", name: "" },
      components: {
        Page: (props: { params?: ApplicationsPageProps["params"] }) => (
          <ApplicationsPage params={props.params} />
        ),
      },
    },
    {
      id: PAGES.projects,
      components: {
        Page: () => <AppProjectsPage />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "argocd",
      visible: installed,
      title: "ArgoCD",
      // Freelens numbers its own sidebar items in tens (Favourites 0, Cluster 10, to Custom
      // Resources 110); an extension without a number lands after all of them.
      orderNumber: 5,
      components: {
        Icon: ArgoCDIcon,
      },
    },
    {
      id: "argocd-dashboard",
      visible: installed,
      parentId: "argocd",
      target: { pageId: PAGES.dashboard },
      title: "Overview",
      components: {},
    },
    {
      id: "argocd-applications",
      visible: installed,
      parentId: "argocd",
      target: { pageId: PAGES.applications },
      title: "Applications",
      components: {},
    },
    {
      id: "argocd-projects",
      visible: installed,
      parentId: "argocd",
      target: { pageId: PAGES.projects },
      title: "Projects",
      components: {},
    },
  ];

  override async onActivate(): Promise<void> {
    // Before any page exists: the loader awaits every onActivate and only then
    // calls register(), so the synchronous readers never run against an empty
    // store. startPersistingState never rejects, so this cannot stall the frame.
    await startPersistingState(this, location.host);

    console.log(
      `[argocd] renderer activated for ${Application.crd.plural} and ${AppProject.crd.plural}`,
    );
  }

  override async onDeactivate(): Promise<void> {
    await flushState();
  }
}
