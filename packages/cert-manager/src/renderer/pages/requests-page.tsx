import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { CertificateRequest } from "../api/kinds";
import { certificateOfRequest, requestStateOf, revisionOfRequest } from "../api/requests";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { useKubeStore } from "../components/use-kube-store";

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

type RequestApi = Renderer.K8sApi.KubeApi<CertificateRequest>;

const certificateOf = (request: CertificateRequest) => certificateOfRequest(request);
const revisionOf = (request: CertificateRequest) => revisionOfRequest(request);

const sortingCallbacks = {
  name: (request: CertificateRequest) => request.getName(),
  namespace: (request: CertificateRequest) => request.getNs(),
  certificate: certificateOf,
  revision: revisionOf,
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

export const RequestsPage = observer(() => {
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
        searchFilters={[(request: CertificateRequest) => request.getSearchFields(), certificateOf]}
        renderHeaderTitle="Certificate Requests"
        renderTableHeader={renderTableHeader}
        renderTableContents={(request: CertificateRequest) => {
          const state = requestStateOf(request);

          return [
            <WithTooltip key="name">{request.getName()}</WithTooltip>,
            <span key="namespace">{request.getNs()}</span>,
            <WithTooltip key="certificate">{certificateOf(request) || "—"}</WithTooltip>,
            <span key="revision">{revisionOf(request) || "—"}</span>,
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
});
