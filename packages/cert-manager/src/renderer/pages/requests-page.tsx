import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import {
  certificateOfRequest,
  certificateRouteOf,
  requestStateOf,
  revisionOfRequest,
} from "../api/requests/requests";
import { CertificateRequest } from "../api/shared/kinds";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { CellLink } from "../components/table";
import { useKubeStore } from "../components/use-kube-store";

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

type RequestApi = Renderer.K8sApi.KubeApi<CertificateRequest>;

const sortingCallbacks = {
  name: (request: CertificateRequest) => request.getName(),
  namespace: (request: CertificateRequest) => request.getNs(),
  certificate: certificateOfRequest,
  revision: revisionOfRequest,
  state: (request: CertificateRequest) => requestStateOf(request).label,
  age: (request: CertificateRequest) => request.getCreationTimestamp(),
};

const renderTableHeader = [
  { title: "Name", sortBy: "name" as const },
  { title: "Namespace", sortBy: "namespace" as const },
  { title: "Certificate", sortBy: "certificate" as const },
  { title: "Revision", sortBy: "revision" as const },
  { title: "State", sortBy: "state" as const },
  { title: "Age", sortBy: "age" as const },
];

export const RequestsPage = observer(
  ({ extension }: { extension: RendererTypes.LensExtension }) => {
    const store = useKubeStore(() => CertificateRequest.getStore<CertificateRequest>());

    if (!store) return null;

    // No root of ours above the host's layout: mount the stylesheet, root class on each state.
    return (
      <>
        <CertManagerStyles />
        <KubeObjectListLayout<CertificateRequest, RequestApi>
          tableId="certManagerRequestsTable"
          className="CertManagerRequests"
          store={store}
          sortingCallbacks={sortingCallbacks}
          searchFilters={[
            (request: CertificateRequest) => request.getSearchFields(),
            certificateOfRequest,
          ]}
          renderHeaderTitle="Certificate Requests"
          renderTableHeader={renderTableHeader}
          renderTableContents={(request: CertificateRequest) => {
            const state = requestStateOf(request);
            const route = certificateRouteOf(request);

            return [
              <WithTooltip key="name">{request.getName()}</WithTooltip>,
              <span key="namespace">{request.getNs()}</span>,
              route ? (
                <span key="certificate" className="CertManager">
                  <CellLink
                    title={`Opens ${route.name} in the certificates page`}
                    onClick={() => void extension.navigate("certificates", route)}
                  >
                    {route.name}
                  </CellLink>
                </span>
              ) : (
                <span key="certificate">—</span>
              ),
              <span key="revision">{revisionOfRequest(request) || "—"}</span>,
              <WithTooltip key="state" tooltip={state.message}>
                <span className="CertManager">
                  <Status tone={state.tone} label={state.label} />
                </span>
              </WithTooltip>,
              <KubeObjectAge object={request} key="age" />,
            ];
          }}
        />
      </>
    );
  },
);
