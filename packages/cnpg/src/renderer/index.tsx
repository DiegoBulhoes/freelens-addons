import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";

import { isInstalled } from "./api/installed";
import { CNPGIcon } from "./icons/cnpg";
import { BackupsPage } from "./pages/backups-page";
import { ClustersPage, type ClustersPageParams } from "./pages/clusters-page";
import { LogicalPage } from "./pages/logical-page";
import { OverviewPage } from "./pages/overview-page";
import { PoolersPage } from "./pages/poolers-page";
import { SchedulesPage } from "./pages/schedules-page";

// Item ids start with `cnpg-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES = {
  overview: "overview",
  clusters: "clusters",
  backups: "backups",
  schedules: "schedules",
  poolers: "poolers",
  logical: "logical",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class CNPGRenderer extends Renderer.LensExtension {
  private openCluster = (name?: string) => void this.navigate(PAGES.clusters, { name: name ?? "" });

  override clusterPages = [
    {
      id: PAGES.overview,
      components: {
        Page: () => (
          <OverviewPage
            navigate={{
              openClusters: this.openCluster,
              openPoolers: () => void this.navigate(PAGES.poolers),
              openSchedules: () => void this.navigate(PAGES.schedules),
              openLogical: () => void this.navigate(PAGES.logical),
            }}
          />
        ),
      },
    },
    {
      id: PAGES.clusters,
      params: { name: "" },
      components: {
        Page: (props: { params?: ClustersPageParams }) => <ClustersPage params={props.params} />,
      },
    },
    {
      id: PAGES.backups,
      components: {
        Page: () => <BackupsPage onOpenCluster={this.openCluster} />,
      },
    },
    {
      id: PAGES.schedules,
      components: {
        Page: () => <SchedulesPage onOpenCluster={this.openCluster} />,
      },
    },
    {
      id: PAGES.poolers,
      components: {
        Page: () => <PoolersPage onOpenCluster={this.openCluster} />,
      },
    },
    {
      id: PAGES.logical,
      components: {
        Page: () => <LogicalPage onOpenCluster={this.openCluster} />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "cnpg",
      visible: installed,
      title: "CloudNativePG",
      orderNumber: 8,
      components: {
        Icon: CNPGIcon,
      },
    },
    ...(
      [
        ["overview", "Overview"],
        ["clusters", "Clusters"],
        ["backups", "Backups"],
        ["schedules", "Schedules"],
        ["poolers", "Poolers"],
        ["logical", "Logical replication"],
      ] as const
    ).map(([page, title]) => ({
      id: `cnpg-${page}`,
      visible: installed,
      parentId: "cnpg",
      target: { pageId: PAGES[page] },
      title,
      components: {},
    })),
  ];

  override async onActivate(): Promise<void> {
    console.log("[cnpg] renderer activated");
  }
}
