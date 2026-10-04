import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";

import { isInstalled } from "./api/installed";
import { MongoDBIcon } from "./icons/mongodb";
import { OverviewPage } from "./pages/overview-page";
import { ReplicaSetsPage, type ReplicaSetsPageParams } from "./pages/replica-sets-page";

// Item ids start with `mongodb-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES = {
  overview: "overview",
  replicaSets: "clusters",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class MongoDBRenderer extends Renderer.LensExtension {
  private openReplicaSets = (name?: string) =>
    void this.navigate(PAGES.replicaSets, { name: name ?? "" });

  override clusterPages = [
    {
      id: PAGES.overview,
      components: {
        Page: () => <OverviewPage openReplicaSets={this.openReplicaSets} />,
      },
    },
    {
      id: PAGES.replicaSets,
      params: { name: "" },
      components: {
        Page: (props: { params?: ReplicaSetsPageParams }) => (
          <ReplicaSetsPage params={props.params} />
        ),
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "mongodb",
      visible: installed,
      title: "MongoDB",
      orderNumber: 9,
      components: {
        Icon: MongoDBIcon,
      },
    },
    ...(
      [
        ["overview", "Overview"],
        ["replicaSets", "Clusters"],
      ] as const
    ).map(([page, title]) => ({
      id: `mongodb-${PAGES[page]}`,
      visible: installed,
      parentId: "mongodb",
      target: { pageId: PAGES[page] },
      title,
      components: {},
    })),
  ];

  override async onActivate(): Promise<void> {
    console.log("[mongodb] renderer activated");
  }
}
