import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { certificateStatusOf } from "../api/certificates/attention";
import {
  certificateNames,
  certificateSearchTexts,
  certificatesEmptyText,
  FILTER_LABELS,
  FILTER_TITLES,
  isCertificateFilter,
  selectCertificates,
} from "../api/certificates/certificate-filter";
import { chainInputsOf } from "../api/certificates/chain";
import {
  ALARM_DAYS,
  describeRenewalDue,
  describeTimeLeft,
  expiresWithin,
  renewalTimeOf,
  timeLeft,
} from "../api/certificates/expiry";
import { keyOf } from "../api/shared/namespace-scope";
import { describeLoadState, rowsFor } from "../api/shared/store-state";
import type { CertificateLike } from "../api/shared/types";
import { renewalRefusal, renewalWarning } from "../api/writes/bulk";
import { CertificateDrawer } from "../certificate/certificate-drawer";
import { renewOrThrow } from "../certificate/renew";
import { bulkAction } from "../components/bulk";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { ListingBanner } from "../components/listing-banner";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";
import { useNamedRow, useRequestedFilter } from "../hooks/use-list-params";

export interface CertificatesRouteParams {
  namespace: { get(): string };
  name: { get(): string };
  filter: { get(): string };
}

export const CertificatesRoute = observer(
  ({
    params,
    extension,
  }: {
    params?: CertificatesRouteParams;
    extension: RendererTypes.LensExtension;
  }) => {
    const stores = useCertManagerStores();
    const [filter, setFilter] = useRequestedFilter(
      params?.filter.get() ?? "",
      isCertificateFilter,
      "all",
    );
    const [selectedKey, setSelectedKey] = useNamedRow(
      params?.name.get() ? `${params.namespace.get()}/${params.name.get()}` : "",
    );

    if (stores.state === "not-installed") {
      return (
        <div className="CertManager CertManager-page">
          <CertManagerStyles />
          <p className="CertManager-section__note">{describeLoadState(stores.state)}</p>
        </div>
      );
    }

    const now = Date.now();
    const rows = rowsFor(stores.state, selectCertificates(stores.certificates, filter, "", now));
    const opened = stores.certificates.find((each) => keyOf(each) === selectedKey);
    const inputs = chainInputsOf(stores);

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
        // An operator's own issuer name, such as OpenTelemetry's, pushes the page sideways unclipped.
        className: "CertManager-table__fill",
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
          const due = describeRenewalDue(certificate, now);

          return due.late ? (
            <span className="CertManager-text--warning">{due.text}</span>
          ) : (
            due.text
          );
        },
        sortValue: renewalTimeOf,
      },
      {
        title: "Names",
        className: "CertManager-table__fill",
        cell: certificateNames,
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
        onOpen={(certificate) => setSelectedKey(keyOf(certificate))}
        banner={<ListingBanner failed={stores.failed} gaveUp={stores.gaveUp} />}
        empty={certificatesEmptyText(
          stores.state,
          stores.certificatesKnown,
          stores.certificates.length,
        )}
        filters={
          <FilterChips
            labels={FILTER_LABELS}
            titles={FILTER_TITLES}
            current={filter}
            onChange={setFilter}
          />
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
              warnOf: renewalWarning(inputs),
              run: renewOrThrow,
            }),
          ],
        }}
      >
        <CertificateDrawer
          certificate={opened}
          inputs={inputs}
          now={now}
          onClose={() => setSelectedKey(undefined)}
          onOpenIssuer={(route) => void extension.navigate("issuers", route)}
        />
      </ListPage>
    );
  },
);
