import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";

import { type OpenPage, PAGE_TITLES } from "./api/overview/attention";
import { isInstalled } from "./api/shared/installed";
import { PrometheusIcon } from "./icons/prometheus";
import { InstancesPage } from "./pages/instances-page";
import type { ListParams } from "./pages/list-params";
import { MonitorsPage } from "./pages/monitors-page";
import { OverviewPage } from "./pages/overview-page";
import { RulesPage } from "./pages/rules-page";
import { UsageNodesPage } from "./pages/usage-nodes-page";
import { UsagePodsPage } from "./pages/usage-pods-page";

// Item ids start with `prometheus-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES = {
  overview: "overview",
  monitors: "monitors",
  rules: "rules",
  instances: "instances",
} as const;

const USAGE_PAGES = {
  nodes: "usage-nodes",
  pods: "usage-pods",
} as const;

// A card opens a list on a filter, an attention row or a drawer link on its object's drawer.
const LIST_PARAMS = { kind: "", namespace: "", name: "", filter: "" };

const TITLES: Record<keyof typeof PAGES, string> = { overview: "Overview", ...PAGE_TITLES };

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class PrometheusRenderer extends Renderer.LensExtension {
  private open: OpenPage = (page, params = {}) =>
    void this.navigate(PAGES[page], {
      kind: params.kind ?? "",
      namespace: params.namespace ?? "",
      name: params.name ?? "",
      filter: params.filter ?? "",
    });

  override clusterPages = [
    {
      id: PAGES.overview,
      components: { Page: () => <OverviewPage open={this.open} /> },
    },
    {
      id: PAGES.monitors,
      params: LIST_PARAMS,
      components: {
        Page: (props: { params?: ListParams }) => (
          <MonitorsPage params={props.params} open={this.open} />
        ),
      },
    },
    {
      id: PAGES.rules,
      params: LIST_PARAMS,
      components: {
        Page: (props: { params?: ListParams }) => (
          <RulesPage params={props.params} open={this.open} />
        ),
      },
    },
    {
      id: PAGES.instances,
      params: LIST_PARAMS,
      components: {
        Page: (props: { params?: ListParams }) => <InstancesPage params={props.params} />,
      },
    },
    {
      id: USAGE_PAGES.nodes,
      components: { Page: () => <UsageNodesPage /> },
    },
    {
      id: USAGE_PAGES.pods,
      components: { Page: () => <UsagePodsPage /> },
    },
  ];

  override clusterPageMenus = [
    {
      id: "prometheus",
      visible: installed,
      title: "Prometheus",
      orderNumber: 12,
      components: { Icon: PrometheusIcon },
    },
    ...(Object.keys(PAGES) as (keyof typeof PAGES)[]).map((page) => ({
      id: `prometheus-${PAGES[page]}`,
      visible: installed,
      parentId: "prometheus",
      target: { pageId: PAGES[page] },
      title: TITLES[page],
      components: {},
    })),
    // Two screens of one feature: a sub-group, as the design standard has it, not tabs.
    {
      id: "prometheus-usage",
      visible: installed,
      parentId: "prometheus",
      title: "Usage",
      components: {},
    },
    ...(
      [
        ["prometheus-usage-nodes", USAGE_PAGES.nodes, "Nodes"],
        ["prometheus-usage-pods", USAGE_PAGES.pods, "Pods"],
      ] as const
    ).map(([id, pageId, title]) => ({
      id,
      visible: installed,
      parentId: "prometheus-usage",
      target: { pageId },
      title,
      components: {},
    })),
  ];

  override async onActivate(): Promise<void> {
    console.log("[prometheus] renderer activated");
  }
}
