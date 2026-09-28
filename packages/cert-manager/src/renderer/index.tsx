import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { isInstalled } from "./api/installed";
import { CertManagerIcon } from "./icons/cert-manager";
import { CertificatesRoute, type CertificatesRouteParams } from "./pages/certificates-route";
import { IssuersPage } from "./pages/issuers-page";
import { OverviewPage } from "./pages/overview-page";
import { RequestsPage } from "./pages/requests-page";
import { UnmanagedPage } from "./pages/unmanaged-page";

/**
 * Page ids are scoped to this extension by Freelens, so they stay short. The
 * sidebar item ids are not: Freelens builds each item's `data-testid` from the
 * extension name and the item id, and the e2e harness drives the sidebar by the
 * suffix of that id — so every item id here starts with `cert-manager-`.
 */
const PAGES = {
  overview: "overview",
  certificates: "certificates",
  issuers: "issuers",
  requests: "requests",
  unmanaged: "unmanaged",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
/**
 * The sidebar's own CRD list: the host keeps it loaded and watched while the
 * cluster is open, so the group appears and disappears with the operator,
 * without a reload. Until the list first arrives the group stays hidden.
 */
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class CertManagerRenderer extends Renderer.LensExtension {
  override clusterPages = [
    {
      id: PAGES.overview,
      components: {
        Page: () => <OverviewPage extension={this} />,
      },
    },
    {
      // The list and one certificate share this page, so the sidebar keeps the
      // Certificates item lit whichever is showing.
      id: PAGES.certificates,
      params: { namespace: "", name: "", filter: "" },
      components: {
        Page: (props: { params?: CertificatesRouteParams }) => (
          <CertificatesRoute params={props.params} extension={this} />
        ),
      },
    },
    {
      id: PAGES.issuers,
      components: {
        Page: () => <IssuersPage extension={this} />,
      },
    },
    {
      id: PAGES.requests,
      components: {
        Page: () => <RequestsPage />,
      },
    },
    {
      id: PAGES.unmanaged,
      components: {
        Page: () => <UnmanagedPage />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "cert-manager",
      visible: installed,
      title: "cert-manager",
      // Freelens numbers its own sidebar items in tens (Favourites 0, Cluster 10, to Custom
      // Resources 110); an extension without a number lands after all of them.
      orderNumber: 6,
      components: {
        Icon: CertManagerIcon,
      },
    },
    {
      id: "cert-manager-overview",
      visible: installed,
      parentId: "cert-manager",
      target: { pageId: PAGES.overview },
      title: "Overview",
      components: {},
    },
    {
      id: "cert-manager-certificates",
      visible: installed,
      parentId: "cert-manager",
      target: { pageId: PAGES.certificates },
      title: "Certificates",
      components: {},
    },
    {
      id: "cert-manager-issuers",
      visible: installed,
      parentId: "cert-manager",
      target: { pageId: PAGES.issuers },
      title: "Issuers",
      components: {},
    },
    {
      id: "cert-manager-requests",
      visible: installed,
      parentId: "cert-manager",
      target: { pageId: PAGES.requests },
      title: "Requests",
      components: {},
    },
    {
      id: "cert-manager-unmanaged",
      visible: installed,
      parentId: "cert-manager",
      target: { pageId: PAGES.unmanaged },
      title: "Unmanaged TLS",
      components: {},
    },
  ];

  override async onActivate(): Promise<void> {
    console.log("[cert-manager] renderer activated");
  }
}
