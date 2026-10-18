import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";

import { isInstalled } from "./api/shared/installed";
import { OpenTelemetryIcon } from "./icons/opentelemetry";
import { CollectorsPage, type CollectorsParams } from "./pages/collectors-page";
import { CoveragePage, type CoverageParams } from "./pages/coverage-page";
import { type OpenPage, OverviewPage } from "./pages/overview-page";

// Item ids start with `opentelemetry-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES = {
  overview: "overview",
  coverage: "coverage",
  collectors: "collectors",
} as const;

// Typed apart: in one array literal, coverage's `filter` would widen collectors' params.
const PARAMS: Record<"coverage" | "collectors", Record<string, string>> = {
  coverage: { kind: "", namespace: "", name: "", filter: "" },
  collectors: { namespace: "", name: "" },
};

const TITLES: Record<keyof typeof PAGES, string> = {
  overview: "Overview",
  coverage: "Coverage",
  collectors: "Collectors",
};

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class OpenTelemetryRenderer extends Renderer.LensExtension {
  private open: OpenPage = (page, params = {}) =>
    void this.navigate(
      PAGES[page],
      page === "coverage"
        ? {
            kind: params.kind ?? "",
            namespace: params.namespace ?? "",
            name: params.name ?? "",
            filter: params.filter ?? "",
          }
        : { namespace: params.namespace ?? "", name: params.name ?? "" },
    );

  override clusterPages = [
    {
      id: PAGES.overview,
      components: { Page: () => <OverviewPage open={this.open} /> },
    },
    {
      // A card opens the list on a filter, an attention row on a row's drawer.
      id: PAGES.coverage,
      params: PARAMS.coverage,
      components: {
        Page: (props: { params?: CoverageParams }) => (
          <CoveragePage params={props.params} open={this.open} />
        ),
      },
    },
    {
      id: PAGES.collectors,
      params: PARAMS.collectors,
      components: {
        Page: (props: { params?: CollectorsParams }) => <CollectorsPage params={props.params} />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "opentelemetry",
      visible: installed,
      title: "OpenTelemetry",
      orderNumber: 11,
      components: { Icon: OpenTelemetryIcon },
    },
    ...(Object.keys(PAGES) as (keyof typeof PAGES)[]).map((page) => ({
      id: `opentelemetry-${PAGES[page]}`,
      visible: installed,
      parentId: "opentelemetry",
      target: { pageId: PAGES[page] },
      title: TITLES[page],
      components: {},
    })),
  ];

  override async onActivate(): Promise<void> {
    console.log("[opentelemetry] renderer activated");
  }
}
