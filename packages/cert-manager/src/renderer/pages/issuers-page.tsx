import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import {
  getIssuerRows,
  getMissingIssuers,
  type IssuerIndex,
  type IssuerRow,
  issuerStatusOf,
  issuersHeadline,
} from "../api/issuers";
import type { CertificateLike } from "../api/types";
import { NamespaceFilter } from "../components/namespace-filter";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";

export const IssuersPage = observer(({ extension }: { extension: RendererTypes.LensExtension }) => {
  const stores = useCertManagerStores();

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
  const broken = rows.filter((row) => !row.ready);
  const ready = rows.filter((row) => row.ready);

  const open = (certificate: CertificateLike) =>
    void extension.navigate("certificates", {
      namespace: certificate.getNs() ?? "",
      name: certificate.getName(),
    });

  const dependents = (certificates: CertificateLike[]) =>
    certificates.length === 0 ? (
      <span className="CertManager-muted">No certificate uses it.</span>
    ) : (
      <div className="CertManager-chips">
        {certificates.map((certificate) => (
          <button
            type="button"
            key={`${certificate.getNs()}/${certificate.getName()}`}
            className="CertManager-chip"
            title={`Opens ${certificate.getName()} in the certificates page`}
            onClick={() => open(certificate)}
          >
            <span>{certificate.getName()}</span>
            <span className="CertManager-chip__meta">{certificate.getNs()}</span>
          </button>
        ))}
      </div>
    );

  const scope = (row: { kind: string; issuer: { getNs(): string | undefined } }) =>
    row.kind === "ClusterIssuer" ? "ClusterIssuer" : `Issuer in ${row.issuer.getNs()}`;

  const count = (certificates: CertificateLike[]) =>
    `${certificates.length} ${certificates.length === 1 ? "certificate" : "certificates"}`;

  return (
    <div className="CertManager CertManager-page">
      <CertManagerStyles />
      <div className="CertManager-page__head">
        <div>
          <h1 className="CertManager-page__headline">{issuersHeadline(rows, missing)}</h1>
          <p className="CertManager-page__subline">
            Each issuer lists the certificates that stop renewing if it breaks. ClusterIssuers are
            listed whatever namespaces are chosen; their certificates, only in those.
          </p>
        </div>
        <div className="CertManager-page__actions">
          <NamespaceFilter />
        </div>
      </div>

      {rows.length + missing.length === 0 && (
        <p className="CertManager-section__note">
          No Issuer in the namespaces chosen and no ClusterIssuer, and no certificate there names
          one.
        </p>
      )}

      <div className="CertManager-list">
        {broken.map((row) => (
          <section
            key={`${row.kind}/${row.issuer.getNs() ?? ""}/${row.issuer.getName()}`}
            className="CertManager-box CertManager-box--critical"
            data-state="failed"
          >
            <div className="CertManager-box__head">
              <IssuerStatus row={row} />
              <span className="CertManager-box__title">
                <code>{row.issuer.getName()}</code>
                <span className="CertManager-box__meta">
                  {scope(row)} · {row.type}
                </span>
              </span>
              <span className="CertManager-box__count">{count(row.dependents)}</span>
            </div>
            {row.message && <p className="CertManager-box__reason">{row.message}</p>}
            {dependents(row.dependents)}
          </section>
        ))}

        {missing.map((entry) => (
          <section
            key={`${entry.kind}/${entry.namespace ?? ""}/${entry.name}`}
            className="CertManager-box CertManager-box--critical"
            data-state="missing"
          >
            <div className="CertManager-box__head">
              <Status tone="critical" label="Missing" />
              <span className="CertManager-box__title">
                <code>{entry.name}</code>
                <span className="CertManager-box__meta">
                  {entry.kind}
                  {entry.namespace ? ` in ${entry.namespace}` : ""} · named and not found
                </span>
              </span>
              <span className="CertManager-box__count">{count(entry.dependents)}</span>
            </div>
            <p className="CertManager-box__reason">
              Create it, or correct the name in the certificates that use it.
            </p>
            {dependents(entry.dependents)}
          </section>
        ))}

        {ready.map((row) => (
          <section
            key={`${row.kind}/${row.issuer.getNs() ?? ""}/${row.issuer.getName()}`}
            className="CertManager-box CertManager-box--ok"
            data-state="ready"
          >
            <div className="CertManager-box__head">
              <IssuerStatus row={row} />
              <span className="CertManager-box__title">
                <code>{row.issuer.getName()}</code>
                <span className="CertManager-box__meta">
                  {scope(row)} · {row.type}
                </span>
              </span>
              <span className="CertManager-box__count">{count(row.dependents)}</span>
            </div>
            {dependents(row.dependents)}
          </section>
        ))}
      </div>
    </div>
  );
});

function IssuerStatus({ row }: { row: IssuerRow }) {
  const status = issuerStatusOf(row);

  return <Status tone={status.tone} label={status.label} />;
}
