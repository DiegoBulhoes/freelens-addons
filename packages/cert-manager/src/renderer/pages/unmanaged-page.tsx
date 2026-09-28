import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { getServedTls, getUnmanagedSecrets, type ServedState } from "../api/unmanaged";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";
import { useTlsInventory } from "../hooks/use-tls-inventory";

const {
  Navigation: { navigate },
} = Renderer;

const STATE_LABEL: Record<ServedState, string> = {
  unmanaged: "no Certificate",
  missing: "Secret missing",
  pending: "being issued",
  managed: "managed",
};

/** Nothing behind it is the problem the page exists for; being issued is on its way. */
const STATE_TONE: Record<ServedState, "critical" | "warning" | "ok"> = {
  unmanaged: "critical",
  missing: "critical",
  pending: "warning",
  managed: "ok",
};

/**
 * The page for what the rest of the extension cannot see: TLS that no
 * Certificate stands behind. An absence renders as nothing at all in every list
 * cert-manager keeps, so this one looks from the other side — from what an
 * Ingress serves, and from what is stored.
 *
 * Secrets are listed by name only. The data never leaves the API server.
 */
export const UnmanagedPage = observer(() => {
  const stores = useCertManagerStores();
  const tls = useTlsInventory();

  const served = getServedTls(tls.ingresses, tls.secrets, stores.certificates);
  const gaps = served.filter((entry) => entry.state === "unmanaged" || entry.state === "missing");
  const unmanagedSecrets = getUnmanagedSecrets(tls.secrets, stores.certificates);

  const openList = (path: string, name: string) =>
    navigate(`${path}?search=${encodeURIComponent(name)}`);

  return (
    <div className="CertManager CertManager-page">
      <CertManagerStyles />
      <div className="CertManager-page__head">
        <div>
          <h1 className="CertManager-page__headline">
            {gaps.length === 0
              ? "Every TLS Secret an Ingress serves has a Certificate"
              : `${gaps.length} served TLS ${gaps.length === 1 ? "Secret has" : "Secrets have"} no Certificate`}
          </h1>
          <p
            className={`CertManager-page__subline${gaps.length > 0 ? " CertManager-page__subline--alarm" : ""}`}
          >
            Nothing renews a TLS Secret that no Certificate manages. It works until it expires, and
            cert-manager's lists never show it.
          </p>
        </div>
      </div>

      {tls.secretsError && (
        <div className="CertManager-banner CertManager-banner--critical">
          <span className="CertManager-banner__title">TLS Secrets could not be listed.</span>
          <span className="CertManager-banner__body">
            {tls.secretsError}. Without them every served Secret reads as missing; listing them
            needs permission to list Secrets.
          </span>
        </div>
      )}

      <section className="CertManager-section">
        <h2 className="CertManager-section__title">Served by an Ingress</h2>
        {served.length === 0 ? (
          <p className="CertManager-section__note">No Ingress in scope serves TLS from a Secret.</p>
        ) : (
          <div className="CertManager-list">
            {served.map((entry) => (
              <button
                type="button"
                key={`${entry.namespace}/${entry.ingress}/${entry.secretName}`}
                className={`CertManager-box CertManager-box--${STATE_TONE[entry.state]}`}
                data-state={entry.state}
                onClick={() => openList("/ingresses", entry.ingress)}
              >
                <span className="CertManager-box__head">
                  <span className={`CertManager-tag CertManager-tag--${STATE_TONE[entry.state]}`}>
                    {STATE_LABEL[entry.state]}
                  </span>
                  <span className="CertManager-box__title">
                    <code>{entry.ingress}</code>
                    <span className="CertManager-box__meta">Ingress in {entry.namespace}</span>
                  </span>
                  <span className="CertManager-box__count">
                    {entry.certificate ? `Certificate ${entry.certificate}` : "no Certificate"}
                  </span>
                </span>
                <span className="CertManager-box__reason">
                  Serves <code>{entry.secretName}</code>
                  {entry.hosts.length > 0 && <> for {entry.hosts.join(", ")}</>}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="CertManager-section">
        <h2 className="CertManager-section__title">TLS Secrets without a Certificate</h2>
        <p className="CertManager-section__note">
          Served or not. Some belong to other controllers, such as the API server or an admission
          webhook, and need no Certificate. They are listed so nothing is hidden, and not every one
          is a problem.
        </p>
        {tls.secretsLoaded && unmanagedSecrets.length === 0 ? (
          <p className="CertManager-section__note">None.</p>
        ) : (
          <div className="CertManager-list">
            {unmanagedSecrets.map((secret) => (
              <button
                type="button"
                key={`${secret.getNs()}/${secret.getName()}`}
                className="CertManager-row CertManager-row--info"
                onClick={() => openList("/secrets", secret.getName())}
              >
                <span className="CertManager-row__state">TLS</span>
                <span className="CertManager-row__main">
                  <span className="CertManager-row__name">
                    <b>{secret.getName()}</b>
                    <span className="CertManager-row__meta">{secret.getNs()}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
