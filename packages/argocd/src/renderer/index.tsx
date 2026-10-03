import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";

import { AppProject } from "./api/app-project";
import { Application } from "./api/application";
import { hasImageUpdater, isInstalled } from "./api/installed";
import { flushState, startPersistingState } from "./api/persist";
import { ApplicationDetails } from "./details/application-details";
import { ArgoCDIcon } from "./icons/argocd";
import { ImageUpdaterImagesPage } from "./image-updater/images-page";
import { ImageUpdaterOverviewPage } from "./image-updater/overview-page";
import { IMAGE_UPDATER_PAGES } from "./image-updater/pages";
import { ImageUpdaterRulesPage } from "./image-updater/rules-page";
import { ImageUpdaterUpdatesPage } from "./image-updater/updates-page";
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
// crdStore is kept loaded and watched by the host's sidebar, so visibility follows the CRDs live.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

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
    {
      id: IMAGE_UPDATER_PAGES.overview,
      components: { Page: () => <ImageUpdaterOverviewPage extension={this} /> },
    },
    {
      id: IMAGE_UPDATER_PAGES.rules,
      components: { Page: () => <ImageUpdaterRulesPage extension={this} /> },
    },
    {
      id: IMAGE_UPDATER_PAGES.images,
      components: { Page: () => <ImageUpdaterImagesPage extension={this} /> },
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
