import { Renderer } from "@freelensapp/extensions";

import { __Name__Icon } from "./icons/__NAME__";
import { OverviewPage } from "./pages/overview-page";

/**
 * Page ids are scoped to this extension by Freelens, so they stay short. The
 * sidebar item ids are not: Freelens builds each item's `data-testid` from the
 * extension name and the item id, and the e2e harness drives the sidebar by the
 * suffix of that id — so every item id here starts with `__NAME__-`.
 */
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
      // Freelens numbers its own sidebar items in tens (Favourites 0, Cluster 10, to Custom
      // Resources 110); an extension without a number lands after all of them.
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
