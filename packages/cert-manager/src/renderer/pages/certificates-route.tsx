import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import { certificateStatusOf } from "../api/attention";
import { renewalRefusal } from "../api/bulk";
import {
  type CertificateFilter,
  certificateSearchTexts,
  FILTER_LABELS,
  FILTER_TITLES,
  isCertificateFilter,
  selectCertificates,
} from "../api/certificate-filter";
import type { ChainInputs } from "../api/chain";
import {
  ALARM_DAYS,
  describeMoment,
  describeTimeLeft,
  expiresWithin,
  timeLeft,
} from "../api/expiry";
import type { CertificateLike } from "../api/types";
import { CertificateDrawer } from "../certificate/certificate-drawer";
import { renewOrThrow } from "../certificate/renew";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";

export interface CertificatesRouteParams {
  namespace: { get(): string };
  name: { get(): string };
  filter: { get(): string };
}

const keyOf = (certificate: CertificateLike) => `${certificate.getNs()}/${certificate.getName()}`;

const renewalOf = (certificate: CertificateLike) => {
  const at = Date.parse(certificate.status?.renewalTime ?? "");

  return Number.isNaN(at) ? undefined : at;
};

export const CertificatesRoute = observer(
  ({
    params,
    extension,
  }: {
    params?: CertificatesRouteParams;
    extension: RendererTypes.LensExtension;
  }) => {
    const stores = useCertManagerStores();
    const requested = params?.filter.get() ?? "";
    const [filter, setFilter] = useState<CertificateFilter>(
      isCertificateFilter(requested) ? requested : "all",
    );
    const named = params?.name.get() ? `${params.namespace.get()}/${params.name.get()}` : "";
    const [openKey, setOpenKey] = useState<string | undefined>(named || undefined);

    // A link from another page names a certificate: its drawer opens.
    useEffect(() => {
      if (named) setOpenKey(named);
    }, [named]);

    if (!stores.isReady) {
      return (
        <div className="CertManager CertManager-page">
          <CertManagerStyles />
          <p className="CertManager-section__note">
            Waiting for cert-manager's CRDs. If cert-manager is not installed here, there is nothing
            to list.
          </p>
        </div>
      );
    }

    const now = Date.now();
    const rows = selectCertificates(stores.certificates, filter, "", now);
    const opened = stores.certificates.find((each) => keyOf(each) === openKey);
    const inputs: ChainInputs = {
      index: { issuers: stores.issuers, clusterIssuers: stores.clusterIssuers },
      requests: stores.requests,
      orders: stores.orders,
      challenges: stores.challenges,
    };

    const columns: Column<CertificateLike>[] = [
      {
        title: "Certificate",
        className: "CertManager-table__shrink",
        cell: (certificate) => certificate.getName(),
        sortValue: (certificate) => certificate.getName(),
      },
      {
        title: "Namespace",
        className: "CertManager-table__shrink",
        cell: (certificate) => certificate.getNs(),
        sortValue: (certificate) => certificate.getNs(),
      },
      {
        title: "State",
        className: "CertManager-table__shrink",
        cell: (certificate) => {
          const status = certificateStatusOf(certificate, now);

          return <Status tone={status.tone} label={status.label} />;
        },
        sortValue: (certificate) => certificateStatusOf(certificate, now).label,
      },
      {
        title: "Issuer",
        className: "CertManager-table__shrink",
        cell: (certificate) => certificate.spec.issuerRef.name,
        sortValue: (certificate) => certificate.spec.issuerRef.name,
      },
      {
        title: "Expires",
        className: "CertManager-table__shrink",
        cell: (certificate) =>
          expiresWithin(certificate, now, ALARM_DAYS) ? (
            <span className="CertManager-text--warning">{describeTimeLeft(certificate, now)}</span>
          ) : (
            describeTimeLeft(certificate, now)
          ),
        sortValue: (certificate) => timeLeft(certificate, now),
      },
      {
        title: "Renewal due",
        className: "CertManager-table__shrink",
        cell: (certificate) => {
          const at = renewalOf(certificate);

          return at === undefined ? "—" : describeMoment(at, now);
        },
        sortValue: renewalOf,
      },
      {
        title: "Names",
        className: "CertManager-table__fill",
        cell: (certificate) =>
          (certificate.spec.dnsNames ?? []).join(", ") || certificate.spec.commonName || "—",
      },
    ];

    return (
      <ListPage
        title="Certificates"
        subline="Worst first. A certificate opens with its validity, its issuance chain, why it is in its state and commands to copy."
        section="cert-manager-certificates"
        rows={rows}
        columns={columns}
        keyOf={keyOf}
        searchTexts={certificateSearchTexts}
        onOpen={(certificate) => setOpenKey(keyOf(certificate))}
        empty={
          stores.certificates.length === 0
            ? "There is no Certificate in the namespaces chosen in the selector."
            : "No certificate matches that filter."
        }
        filters={
          <div className="CertManager-filters">
            {(Object.keys(FILTER_LABELS) as CertificateFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className="CertManager-filter"
                aria-pressed={filter === key}
                title={FILTER_TITLES[key]}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
          </div>
        }
        selection={{
          hint: "Renews each ticked certificate that can be renewed now; the rest are listed as skipped.",
          actions: [
            bulkAction<CertificateLike>({
              label: "Renew",
              done: "Requested renewal for",
              kind: "certificate",
              tooltip:
                "Asks cert-manager to issue each ticked certificate again now; the current ones stay in use until then.",
              nameOf: keyOf,
              refuse: renewalRefusal(inputs),
              run: renewOrThrow,
            }),
          ],
        }}
      >
        <CertificateDrawer
          certificate={opened}
          inputs={inputs}
          now={now}
          onClose={() => setOpenKey(undefined)}
          onOpenIssuer={(route) => void extension.navigate("issuers", route)}
        />
      </ListPage>
    );
  },
);
