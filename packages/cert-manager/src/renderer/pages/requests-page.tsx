import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { conditionOf } from "../api/expiry";
import { CertificateRequest } from "../api/kinds";
import { useKubeStore } from "../components/use-kube-store";

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

type RequestApi = Renderer.K8sApi.KubeApi<CertificateRequest>;

const CERTIFICATE_NAME = "cert-manager.io/certificate-name";
const REVISION = "cert-manager.io/certificate-revision";

const certificateOf = (request: CertificateRequest) =>
  request.metadata.annotations?.[CERTIFICATE_NAME] ?? "";

const revisionOf = (request: CertificateRequest) =>
  Number(request.metadata.annotations?.[REVISION] ?? 0);

/** "Issued", "Pending", "Denied" — the state a person would say, with the message on hover. */
function readyOf(request: CertificateRequest): {
  label: string;
  message?: string;
  failed: boolean;
} {
  const denied = conditionOf(request, "Denied");

  if (denied?.status === "True") return { label: "Denied", message: denied.message, failed: true };

  const ready = conditionOf(request, "Ready");

  return {
    label: ready?.reason ?? "Unknown",
    message: ready?.message,
    failed: ready?.reason === "Failed",
  };
}

const sortingCallbacks = {
  name: (request: CertificateRequest) => request.getName(),
  namespace: (request: CertificateRequest) => request.getNs(),
  certificate: certificateOf,
  revision: revisionOf,
  state: (request: CertificateRequest) => readyOf(request).label,
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

/**
 * Every CertificateRequest, on the host's own list layout — so this is the one
 * page of the extension where the host's details drawer opens, and where the
 * namespace control and the search field are the host's. The picker shows the
 * current request of one certificate; this shows all of them at once, which is
 * where a burst of failed renewals is visible as a burst.
 */
export const RequestsPage = observer(() => {
  const store = useKubeStore(() => CertificateRequest.getStore<CertificateRequest>());

  // getStore() throws until Freelens has registered the CRD's API.
  if (!store) return null;

  return (
    <KubeObjectListLayout<CertificateRequest, RequestApi>
      tableId="certManagerRequestsTable"
      className="CertManagerRequests"
      store={store}
      sortingCallbacks={sortingCallbacks}
      searchFilters={[(request: CertificateRequest) => request.getSearchFields(), certificateOf]}
      renderHeaderTitle="Certificate Requests"
      renderTableHeader={renderTableHeader}
      renderTableContents={(request: CertificateRequest) => {
        const state = readyOf(request);

        return [
          <WithTooltip key="name">{request.getName()}</WithTooltip>,
          <span key="namespace">{request.getNs()}</span>,
          <WithTooltip key="certificate">{certificateOf(request) || "—"}</WithTooltip>,
          <span key="revision">{revisionOf(request) || "—"}</span>,
          <WithTooltip key="state" tooltip={state.message}>
            <span style={state.failed ? { color: "var(--colorError)" } : undefined}>
              {state.label}
            </span>
          </WithTooltip>,
          <KubeObjectAge object={request} key="age" />,
        ];
      }}
    />
  );
});
