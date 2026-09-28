import { Renderer } from "@freelensapp/extensions";

import { problemOf, severityOf } from "../api/attention";
import { type ChainInputs, chainOf, explanationOf } from "../api/chain";
import { commandsFor } from "../api/commands";
import { describeTimeLeft, isRenewalOverdue, validityOf } from "../api/expiry";
import { issuerKindOf } from "../api/issuers";
import { renewalVerdict } from "../api/renewal";
import type { CertificateLike } from "../api/types";
import { CommandList } from "../components/command-list";
import { ChainView } from "./chain-view";
import { RenewButton } from "./renew-button";
import { ValidityBar } from "./validity-bar";

const {
  Navigation: { navigate },
} = Renderer;

const PROBLEM_SENTENCE = {
  expired: "Expired. Clients reject it.",
  "not-ready": "Not ready: there is no certificate to serve.",
  "renewal-overdue":
    "Still valid, but its renewal is failing. It will expire unless the cause is fixed.",
} as const;

/**
 * One certificate: where it is in its life, why it is stuck if it is, and what to
 * run. The Secret opens in the host's own list, narrowed to it — from a page like
 * this one, the host's details drawer cannot be opened at all.
 */
export function CertificateDetail({
  certificate,
  inputs,
  now,
  onOpenIssuers,
}: {
  certificate: CertificateLike;
  inputs: ChainInputs;
  now: number;
  onOpenIssuers: () => void;
}) {
  const problem = problemOf(certificate, now);
  const chain = chainOf(certificate, inputs);
  const explanation = explanationOf(chain);
  const validity = validityOf(certificate, now);
  const secretName = certificate.spec.secretName;
  const secretExists = Boolean(certificate.status?.notAfter);
  const issuer = certificate.spec.issuerRef;

  return (
    <div className="CertManager-page">
      <div className="CertManager-page__head">
        <div>
          <h1 className="CertManager-page__headline">{certificate.getName()}</h1>
          <p className="CertManager-page__subline">
            {certificate.getNs()} · {describeTimeLeft(certificate, now)} ·{" "}
            {issuerKindOf(issuer) === "External" ? `${issuer.kind} ${issuer.name}` : issuer.name}
          </p>
        </div>
        <RenewButton certificate={certificate} verdict={renewalVerdict(certificate, explanation)} />
      </div>

      {problem && (
        <div
          className={`CertManager-banner${severityOf(problem) === "critical" ? " CertManager-banner--critical" : ""}`}
        >
          <span className="CertManager-banner__title">{PROBLEM_SENTENCE[problem]}</span>
          {explanation?.reason && (
            <span className="CertManager-banner__body">
              {explanation.kind} <code>{explanation.name}</code>: {explanation.reason}
            </span>
          )}
        </div>
      )}

      {validity && (
        <section className="CertManager-section">
          <h2 className="CertManager-section__title">Validity</h2>
          <ValidityBar validity={validity} overdue={isRenewalOverdue(certificate, now)} now={now} />
        </section>
      )}

      <section className="CertManager-section">
        <div className="CertManager-section__bar">
          <h2 className="CertManager-section__title">Issuance chain</h2>
          <button type="button" className="CertManager-link" onClick={onOpenIssuers}>
            All issuers
          </button>
        </div>
        <ChainView chain={chain} explanation={explanation} />
      </section>

      <section className="CertManager-section">
        <h2 className="CertManager-section__title">Details</h2>
        <dl className="CertManager-facts">
          <dt>Names</dt>
          <dd>
            {(certificate.spec.dnsNames ?? []).join(", ") || certificate.spec.commonName || "—"}
          </dd>
          <dt>Secret</dt>
          <dd>
            {secretExists ? (
              <button
                type="button"
                className="CertManager-link"
                onClick={() => navigate(`/secrets?search=${encodeURIComponent(secretName)}`)}
              >
                {secretName}
              </button>
            ) : (
              <span>
                {secretName} <span className="CertManager-muted">(not written yet)</span>
              </span>
            )}
          </dd>
          <dt>Lifetime</dt>
          <dd>
            {certificate.spec.duration ?? "cert-manager's default"}, renewing{" "}
            {certificate.spec.renewBefore
              ? `${certificate.spec.renewBefore} before the end`
              : "at two thirds"}
          </dd>
        </dl>
      </section>

      <section className="CertManager-section">
        <h2 className="CertManager-section__title">Commands</h2>
        <CommandList commands={commandsFor(certificate, problem, explanation)} />
      </section>
    </div>
  );
}
