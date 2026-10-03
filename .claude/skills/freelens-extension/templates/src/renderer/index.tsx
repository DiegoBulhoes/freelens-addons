import { Renderer } from "@freelensapp/extensions";

import { __Name__Icon } from "./icons/__NAME__";
import { OverviewPage } from "./pages/overview-page";

// Item ids start with `__NAME__-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES = {
  overview: "overview",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
export default class __Name__Renderer extends Renderer.LensExtension {
  override clusterPages = [
    {
      id: PAGES.overview,
      components: {
        Page: () => <OverviewPage />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "__NAME__",
      title: "__TITLE__",
      // Host items are numbered in tens (0 to 110); without a number this lands last.
      orderNumber: 6,
      components: {
        Icon: __Name__Icon,
      },
    },
    {
      id: "__NAME__-overview",
      parentId: "__NAME__",
      target: { pageId: PAGES.overview },
      title: "Overview",
      components: {},
    },
  ];

  override async onActivate(): Promise<void> {
    console.log("[__NAME__] renderer activated");
  }
}
