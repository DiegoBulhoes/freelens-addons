import { Renderer } from "@freelensapp/extensions";
import { computed } from "mobx";
import { isInstalled } from "./api/installed";
import { VulnerabilityReport } from "./api/reports";
import { TrivyIcon } from "./icons/trivy";
import { DashboardPage } from "./pages/dashboard-page";
import { RbacPage } from "./pages/rbac-page";
import { VulnerabilityReportsPage } from "./pages/vulnerability-reports-page";
import { WorkloadsRoute, type WorkloadsRouteParams } from "./pages/workloads-route";

const PAGES = {
  dashboard: "dashboard",
  workloads: "workloads",
  vulnerabilities: "vulnerabilities",
  rbac: "rbac",
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

export default class TrivyRenderer extends Renderer.LensExtension {
  override clusterPages = [
    {
      id: PAGES.dashboard,
      components: {
        Page: () => <DashboardPage extension={this} />,
      },
    },
    {
      // The list and one workload share this page, so the sidebar keeps the
      // Workloads item lit whichever is showing.
      id: PAGES.workloads,
      params: { namespace: "", kind: "", name: "" },
      components: {
        Page: (props: { params?: WorkloadsRouteParams }) => (
          <WorkloadsRoute params={props.params} extension={this} />
        ),
      },
    },
    {
      id: PAGES.vulnerabilities,
      components: {
        Page: () => <VulnerabilityReportsPage extension={this} />,
      },
    },
    {
      id: PAGES.rbac,
      components: {
        Page: () => <RbacPage />,
      },
    },
  ];

  override clusterPageMenus = [
    {
      id: "trivy",
      visible: installed,
      title: "Trivy",
      // Freelens numbers its own sidebar items in tens (Favourites 0, Cluster 10, to Custom
      // Resources 110); an extension without a number lands after all of them.
      orderNumber: 7,
      components: {
        Icon: TrivyIcon,
      },
    },
    {
      id: "trivy-dashboard",
      visible: installed,
      parentId: "trivy",
      target: { pageId: PAGES.dashboard },
      title: "Overview",
      components: {},
    },
    {
      id: "trivy-workloads",
      visible: installed,
      parentId: "trivy",
      target: { pageId: PAGES.workloads },
      title: "Workloads",
      components: {},
    },
    {
      id: "trivy-vulnerabilities",
      visible: installed,
      parentId: "trivy",
      target: { pageId: PAGES.vulnerabilities },
      title: "Vulnerabilities",
      components: {},
    },
    {
      id: "trivy-rbac",
      visible: installed,
      parentId: "trivy",
      target: { pageId: PAGES.rbac },
      title: "RBAC",
      components: {},
    },
  ];

  override async onActivate(): Promise<void> {
    console.log(`[trivy] renderer activated for ${VulnerabilityReport.crd.plural}`);
  }
}
