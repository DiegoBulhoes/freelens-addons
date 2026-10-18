import { Renderer } from "@freelensapp/extensions";

import { certificateVerdict, problemOf } from "../api/certificates/attention";
import { certificateNames } from "../api/certificates/certificate-filter";
import { type ChainInputs, chainOf, explanationOf } from "../api/certificates/chain";
import { isRenewalOverdue, validityOf } from "../api/certificates/expiry";
import { type IssuerRoute, issuerRouteOf } from "../api/issuers/issuers";
import { commandsFor } from "../api/shared/commands";
import type { CertificateLike } from "../api/shared/types";
import {
  describeFailures,
  issuanceFailuresOf,
  renewalPhrase,
  renewalVerdict,
  renewNowNote,
} from "../api/writes/renewal";
import { CommandsSection } from "../components/commands-section";
import { DrawerLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { ChainView } from "./chain-view";
import { renewAction } from "./renew";
import { ValidityBar } from "./validity-bar";

const {
  Navigation: { navigate },
} = Renderer;

export function CertificateDrawer({
  certificate,
  inputs,
  now,
  onClose,
  onOpenIssuer,
}: {
  certificate?: CertificateLike;
  inputs: ChainInputs;
  now: number;
  onClose: () => void;
  onOpenIssuer: (route: IssuerRoute) => void;
}) {
  const chain = certificate ? chainOf(certificate, inputs) : [];
  const explanation = explanationOf(chain);
  const verdict = certificate ? renewalVerdict(certificate, explanation) : undefined;
  const validity = certificate ? validityOf(certificate, now) : undefined;
  const issuerRoute = certificate ? issuerRouteOf(certificate) : undefined;
  const failures = certificate ? issuanceFailuresOf(certificate) : undefined;
  const leave = (go: () => void) => {
    onClose();
    go();
  };

  return (
    <ObjectDrawer
      open={Boolean(certificate)}
      kind="Certificate"
      name={certificate?.getName() ?? ""}
      onClose={onClose}
      state={certificate ? certificateVerdict(certificate, explanation, now) : undefined}
      section="cert-manager-certificate"
      actions={certificate && verdict ? [renewAction(certificate, verdict)] : []}
    >
      {certificate && verdict && (
        <>
          <dl className="CertManager-facts">
            <dt>Namespace</dt>
            <dd>{certificate.getNs()}</dd>
            <dt>Issuer</dt>
            <dd>
              {issuerRoute ? (
                <DrawerLink
                  title={`Opens ${issuerRoute.kind} ${issuerRoute.name}, with what depends on it`}
                  onClick={() => leave(() => onOpenIssuer(issuerRoute))}
                >
                  {`${issuerRoute.kind} ${issuerRoute.name}`}
                </DrawerLink>
              ) : (
                `${certificate.spec.issuerRef.kind ?? "Issuer"} ${certificate.spec.issuerRef.name} (external)`
              )}
            </dd>
            <dt>Names</dt>
            <dd>{certificateNames(certificate)}</dd>
            <dt>Secret</dt>
            <dd>
              {certificate.status?.notAfter ? (
                <DrawerLink
                  title={`Opens the Secrets list narrowed to ${certificate.spec.secretName}`}
                  onClick={() =>
                    leave(() =>
                      navigate(
                        `/secrets?search=${encodeURIComponent(certificate.spec.secretName)}`,
                      ),
                    )
                  }
                >
                  {certificate.spec.secretName}
                </DrawerLink>
              ) : (
                <span>
                  {certificate.spec.secretName}{" "}
                  <span className="CertManager-muted">(not written yet)</span>
                </span>
              )}
            </dd>
            <dt>Lifetime</dt>
            <dd>
              {certificate.spec.duration ?? "cert-manager's default"}, renewing{" "}
              {renewalPhrase(certificate.spec)}
            </dd>
            {failures && (
              <>
                <dt>Failures</dt>
                <dd>
                  <span className="CertManager-text--warning">
                    {describeFailures(failures, now)}
                  </span>
                </dd>
              </>
            )}
            <dt>Renew now</dt>
            <dd>{renewNowNote(verdict, failures, now)}</dd>
          </dl>

          {validity && (
            <section className="CertManager-section" data-section="cert-manager-validity">
              <h2 className="CertManager-section__title">Validity</h2>
              <ValidityBar
                validity={validity}
                overdue={isRenewalOverdue(certificate, now)}
                now={now}
              />
            </section>
          )}

          <section className="CertManager-section" data-section="cert-manager-chain">
            <h2 className="CertManager-section__title">Issuance chain</h2>
            <ChainView chain={chain} explanation={explanation} />
          </section>

          <CommandsSection
            commands={commandsFor(certificate, problemOf(certificate, now), explanation)}
            section="cert-manager-commands"
          />
        </>
      )}
    </ObjectDrawer>
  );
}
