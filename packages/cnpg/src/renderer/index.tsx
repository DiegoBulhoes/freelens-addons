import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { isInstalled } from "./api/shared/installed";
import type { OpenPage } from "./api/shared/navigation";
import { CNPGIcon } from "./icons/cnpg";
import { BackupsPage } from "./pages/backups-page";
import { ClustersPage } from "./pages/clusters-page";
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

// A card opens a list on a filter; a row or a link opens its object's drawer by namespace and name.
const LIST_PARAMS = { kind: "", namespace: "", name: "", cluster: "", filter: "" };

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class CNPGRenderer extends Renderer.LensExtension {
  private open: OpenPage = (page, params = {}) =>
    void this.navigate(PAGES[page], {
      kind: params.kind ?? "",
      namespace: params.namespace ?? "",
      name: params.name ?? "",
      cluster: params.cluster ?? "",
      filter: params.filter ?? "",
    });

  override clusterPages: Renderer.LensExtension["clusterPages"] = [
    {
      id: PAGES.overview,
      components: { Page: () => <OverviewPage open={this.open} /> },
    },
    {
      id: PAGES.clusters,
      params: LIST_PARAMS,
      components: {
        Page: (props) => <ClustersPage {...props} open={this.open} />,
      },
    },
    {
      id: PAGES.backups,
      params: LIST_PARAMS,
      components: {
        Page: (props) => <BackupsPage {...props} open={this.open} />,
      },
    },
    {
      id: PAGES.schedules,
      params: LIST_PARAMS,
      components: {
        Page: (props) => <SchedulesPage {...props} open={this.open} />,
      },
    },
    {
      id: PAGES.poolers,
      params: LIST_PARAMS,
      components: {
        Page: (props) => <PoolersPage {...props} open={this.open} />,
      },
    },
    {
      id: PAGES.logical,
      params: LIST_PARAMS,
      components: {
        Page: (props) => <LogicalPage {...props} open={this.open} />,
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
