import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { Application } from "./api/applications/application";
import { AppProject } from "./api/projects/app-project";
import { hasApplicationSets, hasImageUpdater, isInstalled } from "./api/shared/installed";
import { flushState, startPersistingState } from "./api/shared/persist";
import { AppProjectDetails } from "./details/app-project-details";
import { ApplicationDetails } from "./details/application-details";
import { ArgoCDIcon } from "./icons/argocd";
import { type ImagesParams, ImageUpdaterImagesPage } from "./image-updater/images-page";
import { ImageUpdaterOverviewPage } from "./image-updater/overview-page";
import { IMAGE_UPDATER_PAGES } from "./image-updater/pages";
import { ImageUpdaterRulesPage, type RulesParams } from "./image-updater/rules-page";
import { ImageUpdaterUpdatesPage } from "./image-updater/updates-page";
import { AppProjectMenuItem } from "./menus/app-project-menu";
import { ApplicationMenuItem } from "./menus/application-menu";
import { AppProjectsPage } from "./pages/app-projects-page";
import {
  APPLICATION_SETS_PAGE,
  ApplicationSetsPage,
  type ApplicationSetsParams,
} from "./pages/application-sets-page";
import {
  APPLICATIONS_PAGE,
  ApplicationsPage,
  type ApplicationsPageProps,
} from "./pages/applications-page";
import { DashboardPage } from "./pages/dashboard-page";

const PAGES = {
  dashboard: "dashboard",
  applications: APPLICATIONS_PAGE,
  projects: "projects",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
// crdStore is kept loaded and watched by the host's sidebar, so visibility follows the CRDs live.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

const applicationSetsInstalled = computed(() => {
  const names = Renderer.K8sApi.crdStore.items.map((crd) => crd.getName());

  return isInstalled(names) && hasApplicationSets(names);
});

const imageUpdaterInstalled = computed(() => {
  const names = Renderer.K8sApi.crdStore.items.map((crd) => crd.getName());

  return isInstalled(names) && hasImageUpdater(names);
});

export default class ArgoCDRenderer extends Renderer.LensExtension {
  override kubeObjectDetailItems = [
    {
      kind: Application.kind,
      apiVersions: Application.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<Application>) => (
          <ApplicationDetails {...props} extension={this} />
        ),
      },
    },
    {
      kind: AppProject.kind,
      apiVersions: AppProject.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<AppProject>) => (
          <AppProjectDetails {...props} extension={this} />
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

  override clusterPages: Renderer.LensExtension["clusterPages"] = [
    {
      id: PAGES.dashboard,
      components: {
        Page: () => <DashboardPage extension={this} />,
      },
    },
    {
      id: PAGES.applications,
      params: { project: "", projectNamespace: "", status: "", name: "", namespace: "" },
      components: {
        Page: (props: { params?: ApplicationsPageProps["params"] }) => (
          <ApplicationsPage params={props.params} />
        ),
      },
    },
    {
      id: PAGES.projects,
      components: {
        Page: () => <AppProjectsPage extension={this} />,
      },
    },
    {
      id: APPLICATION_SETS_PAGE,
      params: { name: "", namespace: "" },
      components: {
        Page: (props: { params?: ApplicationSetsParams }) => (
          <ApplicationSetsPage extension={this} params={props.params} />
        ),
      },
    },
    {
      id: IMAGE_UPDATER_PAGES.overview,
      components: { Page: () => <ImageUpdaterOverviewPage extension={this} /> },
    },
    {
      id: IMAGE_UPDATER_PAGES.rules,
      params: { name: "", namespace: "", filter: "" },
      components: {
        Page: (props: { params?: RulesParams }) => (
          <ImageUpdaterRulesPage extension={this} params={props.params} />
        ),
      },
    },
    {
      id: IMAGE_UPDATER_PAGES.images,
      params: { filter: "" },
      components: {
        Page: (props: { params?: ImagesParams }) => (
          <ImageUpdaterImagesPage extension={this} params={props.params} />
        ),
      },
    },
    {
      id: IMAGE_UPDATER_PAGES.updates,
      components: { Page: () => <ImageUpdaterUpdatesPage extension={this} /> },
    },
  ];

  override clusterPageMenus = [
    {
      id: "argocd",
      visible: installed,
      title: "ArgoCD",
      // The host's own items are numbered in tens from 0; without a number the group lands last.
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
      id: "argocd-application-sets",
      visible: applicationSetsInstalled,
      parentId: "argocd",
      target: { pageId: APPLICATION_SETS_PAGE },
      title: "ApplicationSets",
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
    {
      id: "argocd-image-updater",
      visible: imageUpdaterInstalled,
      parentId: "argocd",
      title: "Image Updater",
      components: {},
    },
    ...(
      [
        ["image-updater-overview", IMAGE_UPDATER_PAGES.overview, "Overview"],
        ["image-updater-rules", IMAGE_UPDATER_PAGES.rules, "Rules"],
        ["image-updater-images", IMAGE_UPDATER_PAGES.images, "Images"],
        ["image-updater-updates", IMAGE_UPDATER_PAGES.updates, "Updates"],
      ] as const
    ).map(([id, pageId, title]) => ({
      id,
      visible: imageUpdaterInstalled,
      parentId: "argocd-image-updater",
      target: { pageId },
      title,
      components: {},
    })),
  ];

  override async onActivate(): Promise<void> {
    // Awaited so state is loaded before register() mounts any page; it never rejects.
    await startPersistingState(this, location.host);

    console.log(
      `[argocd] renderer activated for ${Application.crd.plural} and ${AppProject.crd.plural}`,
    );
  }

  override async onDeactivate(): Promise<void> {
    await flushState();
  }
}
