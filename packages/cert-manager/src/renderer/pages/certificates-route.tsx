import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import {
  type CertificateFilter,
  FILTER_LABELS,
  FILTER_TITLES,
  isCertificateFilter,
  selectCertificates,
} from "../api/certificate-filter";
import type { ChainInputs } from "../api/chain";
import { CertificateDetail } from "../certificate/certificate-detail";
import { CertificateList, certificateKey } from "../certificate/certificate-list";
import { NamespaceFilter } from "../components/namespace-filter";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";

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
    const requested = params?.filter.get() ?? "";
    const [filter, setFilter] = useState<CertificateFilter>(
      isCertificateFilter(requested) ? requested : "all",
    );
    const [search, setSearch] = useState("");

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
    const shown = selectCertificates(stores.certificates, filter, search, now);
    const namespace = params?.namespace.get() ?? "";
    const name = params?.name.get() ?? "";
    const fromRoute = stores.certificates.find(
      (each) => each.getNs() === namespace && each.getName() === name,
    );
    const selected = fromRoute ?? shown[0];
    const inputs: ChainInputs = {
      index: { issuers: stores.issuers, clusterIssuers: stores.clusterIssuers },
      requests: stores.requests,
      orders: stores.orders,
      challenges: stores.challenges,
    };

    return (
      <div className="CertManager CertManager-picker">
        <CertManagerStyles />

        <div className="CertManager-picker__side">
          <div className="CertManager-section">
            <NamespaceFilter />
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
          </div>

          <input
            className="CertManager-search"
            type="search"
            value={search}
            placeholder={`Filter ${stores.certificates.length} certificates`}
            aria-label="Search certificates"
            onChange={(event) => setSearch(event.target.value)}
          />

          <CertificateList
            certificates={shown}
            selected={selected ? certificateKey(selected) : undefined}
            now={now}
            onSelect={(certificate) =>
              void extension.navigate("certificates", {
                namespace: certificate.getNs() ?? "",
                name: certificate.getName(),
                filter,
              })
            }
          />
        </div>

        <div className="CertManager-picker__detail">
          {selected ? (
            <CertificateDetail
              certificate={selected}
              inputs={inputs}
              now={now}
              onOpenIssuers={() => void extension.navigate("issuers")}
            />
          ) : (
            <p className="CertManager-picker__empty">
              {stores.certificates.length === 0
                ? "There is no Certificate in the namespaces chosen in the selector."
                : "Nothing matches that filter."}
            </p>
          )}
        </div>
      </div>
    );
  },
);
