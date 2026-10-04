import { Renderer } from "@freelensapp/extensions";

import { certificateVerdict, problemOf } from "../api/attention";
import { type ChainInputs, chainOf, explanationOf } from "../api/chain";
import { commandsFor } from "../api/commands";
import { isRenewalOverdue, validityOf } from "../api/expiry";
import { issuerRouteOf } from "../api/issuers";
import { renewalVerdict } from "../api/renewal";
import type { CertificateLike } from "../api/types";
import { CommandList } from "../components/command-list";
import { DrawerLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { ChainView } from "./chain-view";
import { renewAction } from "./renew";
import { ValidityBar } from "./validity-bar";

const {
  Navigation: { navigate },
} = Renderer;

export interface IssuerRoute {
  kind: string;
  namespace: string;
  name: string;
}

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
            <dd>
              {(certificate.spec.dnsNames ?? []).join(", ") || certificate.spec.commonName || "—"}
            </dd>
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
              {certificate.spec.renewBefore
                ? `${certificate.spec.renewBefore} before the end`
                : "at two thirds"}
            </dd>
            <dt>Renew now</dt>
            <dd>
              {verdict.offer ? (verdict.warning ?? "Offered in the title bar.") : verdict.reason}
            </dd>
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

          <section className="CertManager-section" data-section="cert-manager-commands">
            <h2 className="CertManager-section__title">Commands</h2>
            <CommandList
              commands={commandsFor(certificate, problemOf(certificate, now), explanation)}
            />
          </section>
        </>
      )}
    </ObjectDrawer>
  );
}
