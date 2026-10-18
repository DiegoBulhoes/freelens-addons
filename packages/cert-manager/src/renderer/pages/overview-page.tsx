import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { describeHeadline, getAttentionItems } from "../api/certificates/attention";
import { chainInputsOf, chainOf, explanationOf } from "../api/certificates/chain";
import { describeTimeLeft } from "../api/certificates/expiry";
import { matchesIssuerFilter, overviewSubline, summariseIssuers } from "../api/issuers/issuers";
import { certificateCards } from "../api/overview/overview";
import { bannerFailures, CERTIFICATES_UNKNOWN } from "../api/shared/listing";
import { keyOf } from "../api/shared/namespace-scope";
import { worstOf } from "../api/shared/store-state";
import { getServedTls, matchesServedFilter } from "../api/unmanaged/unmanaged";
import { CertificateRow } from "../certificate/certificate-row";
import { ListingBanner } from "../components/listing-banner";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";
import { useTlsInventory } from "../hooks/use-tls-inventory";

const {
  Component: { Spinner },
} = Renderer;

export const OverviewPage = observer(
  ({ extension }: { extension: RendererTypes.LensExtension }) => {
    const stores = useCertManagerStores();
    const tls = useTlsInventory();

    if (stores.state === "not-installed") {
      return (
        <div className="CertManager CertManager-page">
          <CertManagerStyles />
          <div className="CertManager-page__head">
            <div>
              <h1 className="CertManager-page__headline">cert-manager</h1>
              <p className="CertManager-page__subline">
                Waiting for cert-manager's CRDs. If cert-manager is not installed in this cluster,
                there is nothing here to show.
              </p>
            </div>
          </div>
        </div>
      );
    }

    // The TLS card stands on the Ingresses too: until they list, it would count none.
    if (worstOf(stores.state, tls.ingressListing.state) === "connecting") {
      return (
        <div className="CertManager CertManager-page">
          <CertManagerStyles />
          <Spinner center />
        </div>
      );
    }

    const now = Date.now();
    const { certificates, certificatesKnown } = stores;
    const inputs = chainInputsOf(stores);
    const attention = getAttentionItems(certificates, now);
    const issuers = summariseIssuers(inputs.index, certificates);
    const served = certificatesKnown
      ? getServedTls(tls.ingresses, tls.secrets, certificates, tls.secretsListedIn)
      : [];
    const gaps = served.filter((entry) => matchesServedFilter(entry, "gaps"));
    const issuerTrouble = issuers.entries.filter((entry) =>
      matchesIssuerFilter(entry, "trouble"),
    ).length;

    const openCertificates = (params: Record<string, string>) =>
      void extension.navigate("certificates", params);

    return (
      <div className="CertManager CertManager-page">
        <CertManagerStyles />
        <div className="CertManager-page__head">
          <div>
            <h1 className="CertManager-page__headline">
              {describeHeadline(attention.length, certificates.length, certificatesKnown)}
            </h1>
            <p
              className={`CertManager-page__subline${
                issuerTrouble > 0 ? " CertManager-page__subline--alarm" : ""
              }`}
            >
              {overviewSubline(certificatesKnown, certificates.length, issuers)}
            </p>
          </div>
          <div className="CertManager-page__actions">
            <NamespaceFilter />
          </div>
        </div>

        <ListingBanner
          failed={bannerFailures(stores.failed, tls.ingressListing)}
          gaveUp={stores.gaveUp}
        />

        <div className="CertManager-cards">
          {certificateCards(certificates, now, certificatesKnown).map(
            ({ key, filter, ...card }) => (
              <StatCard
                key={key}
                {...card}
                onOpen={filter ? () => openCertificates({ filter }) : undefined}
              />
            ),
          )}
          <StatCard
            value={issuerTrouble}
            label="Issuers not ready or missing"
            tone="critical"
            title="Opens the issuers that are not ready or missing"
            onOpen={() => void extension.navigate("issuers", { filter: "trouble" })}
          />
          {certificatesKnown && (
            <StatCard
              value={gaps.length}
              label="Served TLS with no Certificate"
              tone="critical"
              title="Opens the served TLS Secrets no Certificate writes"
              onOpen={() => void extension.navigate("unmanaged", { filter: "gaps" })}
            />
          )}
        </div>

        <section className="CertManager-section">
          <h2 className="CertManager-section__title">Needs attention</h2>

          {!certificatesKnown ? (
            <p className="CertManager-section__note">{CERTIFICATES_UNKNOWN}</p>
          ) : certificates.length === 0 ? (
            <p className="CertManager-section__note">
              Nothing needs attention: no certificate is in the namespaces chosen.
            </p>
          ) : attention.length === 0 ? (
            <p className="CertManager-section__note">
              Nothing needs attention. Certificates that end soon will renew on schedule, and none
              is late.
            </p>
          ) : (
            <div className="CertManager-list">
              {attention.map((item) => {
                const explanation = explanationOf(chainOf(item.certificate, inputs));

                return (
                  <CertificateRow
                    key={keyOf(item.certificate)}
                    certificate={item.certificate}
                    state={item.headline}
                    tone={item.severity}
                    meta={`${item.certificate.getNs() ?? ""} · ${item.certificate.spec.issuerRef.name}`}
                    reason={
                      explanation?.reason
                        ? `${explanation.kind}: ${explanation.reason}`
                        : (item.detail ?? "")
                    }
                    aside={describeTimeLeft(item.certificate, now)}
                    onOpen={() =>
                      openCertificates({
                        namespace: item.certificate.getNs() ?? "",
                        name: item.certificate.getName(),
                      })
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  },
);
