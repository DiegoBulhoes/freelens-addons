import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { isInstalled } from "./api/installed";
import { CertManagerIcon } from "./icons/cert-manager";
import { CertificatesRoute, type CertificatesRouteParams } from "./pages/certificates-route";
import { IssuersPage, type IssuersPageParams } from "./pages/issuers-page";
import { OverviewPage } from "./pages/overview-page";
import { RequestsPage } from "./pages/requests-page";
import { UnmanagedPage } from "./pages/unmanaged-page";

// Item ids start with `cert-manager-`: the e2e harness drives the sidebar by data-testid suffix.
const PAGES = {
  overview: "overview",
  certificates: "certificates",
  issuers: "issuers",
  requests: "requests",
  unmanaged: "unmanaged",
} as const;

// Registration fields are read right after construction; computing them in onActivate is too late.
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);

export default class CertManagerRenderer extends Renderer.LensExtension {
  override clusterPages: Renderer.LensExtension["clusterPages"] = [
    {
      id: PAGES.overview,
      components: {
        Page: () => <OverviewPage extension={this} />,
      },
    },
    {
      // Naming a certificate opens its drawer on the list.
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
      params: { kind: "", namespace: "", name: "" },
      components: {
        Page: (props: { params?: IssuersPageParams }) => (
          <IssuersPage params={props.params} extension={this} />
        ),
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
        Page: () => <UnmanagedPage extension={this} />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "cert-manager",
      visible: installed,
      title: "cert-manager",
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
