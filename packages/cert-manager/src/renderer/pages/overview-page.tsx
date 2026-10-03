import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { getAttentionItems, headlineOf } from "../api/attention";
import { type ChainInputs, chainOf, explanationOf } from "../api/chain";
import {
  ALARM_DAYS,
  describeTimeLeft,
  EXPIRING_DAYS,
  expiresWithin,
  isReady,
  isRenewalOverdue,
} from "../api/expiry";
import { getIssuerRows, getMissingIssuers, type IssuerIndex } from "../api/issuers";
import { getServedTls, isGap } from "../api/unmanaged";
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

    if (!stores.isReady) {
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

    if (!stores.hasLoaded) {
      return (
        <div className="CertManager CertManager-page">
          <CertManagerStyles />
          <Spinner center />
        </div>
      );
    }

    const now = Date.now();
    const index: IssuerIndex = { issuers: stores.issuers, clusterIssuers: stores.clusterIssuers };
    const inputs: ChainInputs = {
      index,
      requests: stores.requests,
      orders: stores.orders,
      challenges: stores.challenges,
    };
    const certificates = stores.certificates;
    const attention = getAttentionItems(certificates, now);
    const brokenIssuers = getIssuerRows(index, certificates).filter((row) => !row.ready);
    const missingIssuers = getMissingIssuers(index, certificates);
    const gaps = getServedTls(tls.ingresses, tls.secrets, certificates).filter(isGap);
    const issuerTrouble = brokenIssuers.length + missingIssuers.length;

    const openCertificates = (params: Record<string, string>) =>
      void extension.navigate("certificates", params);

    return (
      <div className="CertManager CertManager-page">
        <CertManagerStyles />
        <div className="CertManager-page__head">
          <div>
            <h1 className="CertManager-page__headline">
              {headlineOf(attention.length, certificates.length)}
            </h1>
            <p
              className={`CertManager-page__subline${
                issuerTrouble > 0 ? " CertManager-page__subline--alarm" : ""
              }`}
            >
              {certificates.length === 0
                ? "There is no Certificate in the namespaces chosen in the selector. Choose more to see theirs."
                : issuerTrouble > 0
                  ? `${brokenIssuers.length} ${brokenIssuers.length === 1 ? "issuer is" : "issuers are"} not ready, and ${missingIssuers.length} named ${missingIssuers.length === 1 ? "issuer does" : "issuers do"} not exist.`
                  : "Every issuer in use exists and is ready."}
            </p>
          </div>
          <div className="CertManager-page__actions">
            <NamespaceFilter />
          </div>
        </div>

        <div className="CertManager-cards">
          <StatCard
            value={certificates.length}
            label="Certificates"
            title="Opens every certificate in the certificates page"
            onOpen={() => openCertificates({ filter: "all" })}
          />
          <StatCard
            value={certificates.filter((each) => !isReady(each)).length}
            label="Not ready"
            tone="critical"
            title="Opens the certificates that are not ready"
            onOpen={() => openCertificates({ filter: "not-ready" })}
          />
          <StatCard
            value={certificates.filter((each) => isRenewalOverdue(each, now)).length}
            label="Renewal failing"
            tone="warning"
            title="Opens the certificates whose renewal is failing"
            onOpen={() => openCertificates({ filter: "failing" })}
          />
          {/* Not pressable: the picker's window is the month, which this card does not count. */}
          <StatCard
            value={certificates.filter((each) => expiresWithin(each, now, ALARM_DAYS)).length}
            label={`Ending within ${ALARM_DAYS} days`}
            tone="warning"
          />
          <StatCard
            value={certificates.filter((each) => expiresWithin(each, now, EXPIRING_DAYS)).length}
            label={`Ending within ${EXPIRING_DAYS} days`}
            title={`Opens the certificates that end within ${EXPIRING_DAYS} days`}
            onOpen={() => openCertificates({ filter: "expiring" })}
          />
          <StatCard
            value={issuerTrouble}
            label="Issuers not ready or missing"
            tone="critical"
            title="Opens the issuers page"
            onOpen={() => void extension.navigate("issuers")}
          />
          <StatCard
            value={gaps.length}
            label="Served TLS with no Certificate"
            tone="critical"
            title="Opens the unmanaged TLS page"
            onOpen={() => void extension.navigate("unmanaged")}
          />
        </div>

        <section className="CertManager-section">
          <h2 className="CertManager-section__title">Needs attention</h2>

          {certificates.length === 0 ? (
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
                  <button
                    type="button"
                    key={`${item.certificate.getNs()}/${item.certificate.getName()}`}
                    className={`CertManager-row CertManager-row--${item.severity}`}
                    title={`Opens ${item.certificate.getName()} in the certificates page`}
                    onClick={() =>
                      openCertificates({
                        namespace: item.certificate.getNs() ?? "",
                        name: item.certificate.getName(),
                      })
                    }
                  >
                    <span className="CertManager-row__state">{item.headline}</span>
                    <span className="CertManager-row__main">
                      <span className="CertManager-row__name">
                        <b>{item.certificate.getName()}</b>
                        <span className="CertManager-row__meta">
                          {item.certificate.getNs()} · {item.certificate.spec.issuerRef.name}
                        </span>
                      </span>
                      <span className="CertManager-row__reason">
                        {explanation?.reason
                          ? `${explanation.kind}: ${explanation.reason}`
                          : item.detail}
                      </span>
                    </span>
                    <span className="CertManager-row__aside">
                      {describeTimeLeft(item.certificate, now)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  },
);
