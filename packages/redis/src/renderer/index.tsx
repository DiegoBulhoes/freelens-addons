import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { isInstalled } from "./api/shared/installed";
import { KIND_TITLES, type OpenPage } from "./api/shared/navigation";
import type { RedisKind } from "./api/shared/types";
import { RedisIcon } from "./icons/redis";
import { OverviewPage } from "./pages/overview-page";
import { RedisListPage, type RedisListParams } from "./pages/redis-list-page";

const KINDS: RedisKind[] = ["Replication", "Cluster", "Standalone", "Sentinel"];

// Item ids start with `redis-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES: Record<"overview" | RedisKind, string> = {
  overview: "overview",
  Replication: "replications",
  Cluster: "clusters",
  Standalone: "standalones",
  Sentinel: "sentinels",
};

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class RedisRenderer extends Renderer.LensExtension {
  private open: OpenPage = (kind, params = {}) =>
    void this.navigate(PAGES[kind], {
      namespace: params.namespace ?? "",
      name: params.name ?? "",
      filter: params.filter ?? "",
    });

  override clusterPages = [
    {
      id: PAGES.overview,
      components: { Page: () => <OverviewPage open={this.open} /> },
    },
    ...KINDS.map((kind) => ({
      id: PAGES[kind],
      // A card opens a list on a filter; an attention row or a drawer link, one row's drawer.
      params: { namespace: "", name: "", filter: "" },
      components: {
        Page: (props: { params?: RedisListParams }) => (
          <RedisListPage kind={kind} params={props.params} open={this.open} />
        ),
      },
    })),
  ];

  override clusterPageMenus = [
    {
      id: "redis",
      visible: installed,
      title: "Redis",
      orderNumber: 10,
      components: { Icon: RedisIcon },
    },
    ...(["overview", ...KINDS] as const).map((page) => ({
      id: `redis-${PAGES[page]}`,
      visible: installed,
      parentId: "redis",
      target: { pageId: PAGES[page] },
      title: page === "overview" ? "Overview" : KIND_TITLES[page],
      components: {},
    })),
  ];

  override async onActivate(): Promise<void> {
    console.log("[redis] renderer activated");
  }
}
