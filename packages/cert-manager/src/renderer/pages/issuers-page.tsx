import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import {
  getIssuerEntries,
  getIssuerRows,
  getMissingIssuers,
  type IssuerEntry,
  type IssuerIndex,
  issuerKey,
  issuersHeadline,
} from "../api/issuers";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";
import { IssuerDrawer } from "./drawers";

export interface IssuersPageParams {
  kind: { get(): string };
  namespace: { get(): string };
  name: { get(): string };
}

const STATE_OF = { critical: "failed", ok: "ready" } as const;

export const IssuersPage = observer(
  ({
    params,
    extension,
  }: {
    params?: IssuersPageParams;
    extension: RendererTypes.LensExtension;
  }) => {
    const stores = useCertManagerStores();
    const named = params?.name.get()
      ? issuerKey(params.kind.get(), params.namespace.get(), params.name.get())
      : "";
    const [openKey, setOpenKey] = useState<string | undefined>(named || undefined);

    // A certificate's issuer link names one: its drawer opens.
    useEffect(() => {
      if (named) setOpenKey(named);
    }, [named]);

    if (!stores.isReady) {
      return (
        <div className="CertManager CertManager-page">
          <CertManagerStyles />
          <p className="CertManager-section__note">Waiting for cert-manager's CRDs.</p>
        </div>
      );
    }

    const index: IssuerIndex = { issuers: stores.issuers, clusterIssuers: stores.clusterIssuers };
    const rows = getIssuerRows(index, stores.certificates);
    const missing = getMissingIssuers(index, stores.certificates);
    const entries = getIssuerEntries(index, stores.certificates);
    const failing = entries.some((entry) => entry.state.tone === "critical");

    const columns: Column<IssuerEntry>[] = [
      {
        title: "Issuer",
        className: "CertManager-table__shrink",
        cell: (entry) => entry.name,
        sortValue: (entry) => entry.name,
      },
      {
        title: "Kind",
        className: "CertManager-table__shrink",
        cell: (entry) => entry.kind,
        sortValue: (entry) => entry.kind,
      },
      {
        title: "Namespace",
        className: "CertManager-table__shrink",
        cell: (entry) => entry.namespace ?? "—",
        sortValue: (entry) => entry.namespace,
      },
      {
        title: "Type",
        className: "CertManager-table__shrink",
        cell: (entry) => entry.type ?? "—",
        sortValue: (entry) => entry.type,
      },
      {
        title: "State",
        className: "CertManager-table__shrink",
        cell: (entry) => <Status tone={entry.state.tone} label={entry.state.label} />,
        sortValue: (entry) => entry.state.label,
      },
      {
        title: "Certificates",
        className: "CertManager-table__number",
        cell: (entry) => entry.dependents.length,
        sortValue: (entry) => entry.dependents.length,
      },
      {
        title: "Message",
        className: "CertManager-table__fill",
        cell: (entry) => <span className="CertManager-muted">{entry.state.reason}</span>,
      },
    ];

    return (
      <ListPage
        title="Issuers"
        subline={`${issuersHeadline(rows, missing)}. ClusterIssuers are listed whatever namespaces are chosen; their certificates, only in those.`}
        alarm={failing}
        section="cert-manager-issuers"
        rows={entries}
        columns={columns}
        keyOf={(entry) => entry.key}
        searchTexts={(entry) => [
          entry.name,
          entry.kind,
          entry.namespace ?? "",
          entry.type ?? "",
          entry.state.label,
          ...entry.dependents.map((certificate) => certificate.getName()),
        ]}
        stateOf={(entry) => (entry.issuer ? STATE_OF[entry.state.tone] : "missing")}
        onOpen={(entry) => setOpenKey(entry.key)}
        empty="No Issuer in the namespaces chosen and no ClusterIssuer, and no certificate there names one."
      >
        <IssuerDrawer
          entry={entries.find((entry) => entry.key === openKey)}
          onClose={() => setOpenKey(undefined)}
          onOpenCertificate={(certificate) =>
            void extension.navigate("certificates", {
              namespace: certificate.getNs() ?? "",
              name: certificate.getName(),
            })
          }
        />
      </ListPage>
    );
  },
);
