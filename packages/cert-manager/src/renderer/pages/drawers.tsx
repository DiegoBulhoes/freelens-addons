import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { certificateStatusOf } from "../api/certificates/attention";
import { describeTimeLeft, formatUtc, parsedTime } from "../api/certificates/expiry";
import { type IssuerEntry, issuerSettings } from "../api/issuers/issuers";
import { issuerCommands } from "../api/shared/commands";
import { keyOf } from "../api/shared/namespace-scope";
import type { CertificateLike, IngressLike, SecretLike } from "../api/shared/types";
import {
  annotationsOfInterest,
  ingressesServing,
  type SecretsRefusal,
  type ServedTls,
  secretVerdict,
  servedVerdict,
  uncheckedSecretNote,
} from "../api/unmanaged/unmanaged";
import { CertificateRow } from "../certificate/certificate-row";
import { CommandsSection } from "../components/commands-section";
import { DrawerLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";

const {
  Navigation: { navigate },
} = Renderer;

// The details drawer cannot open from here, so the host's list is narrowed to the name.
export const openHostList = (path: string, name: string) =>
  navigate(`${path}?search=${encodeURIComponent(name)}`);

export const IssuerDrawer = observer(
  ({
    entry,
    onClose,
    onOpenCertificate,
  }: {
    entry?: IssuerEntry;
    onClose: () => void;
    onOpenCertificate: (certificate: CertificateLike) => void;
  }) => {
    const now = Date.now();

    return (
      <ObjectDrawer
        open={Boolean(entry)}
        kind={entry?.kind ?? "Issuer"}
        name={entry?.name ?? ""}
        onClose={onClose}
        state={entry?.state}
        section="cert-manager-issuer"
      >
        {entry && (
          <>
            <dl className="CertManager-facts">
              <dt>Kind</dt>
              <dd>{entry.kind}</dd>
              {entry.namespace && (
                <>
                  <dt>Namespace</dt>
                  <dd>{entry.namespace}</dd>
                </>
              )}
              <dt>Type</dt>
              <dd>
                {entry.type ??
                  (entry.state.tone === "info"
                    ? "Unknown: it could not be listed"
                    : "Unknown: it does not exist")}
              </dd>
              <dt>State</dt>
              <dd>
                <Status tone={entry.state.tone} label={entry.state.label} />
              </dd>
              {entry.issuer &&
                issuerSettings(entry.issuer).map(({ term, value }) => (
                  <Fact key={term} term={term} value={value} />
                ))}
            </dl>

            <section className="CertManager-section" data-section="cert-manager-issuer-dependents">
              <h2 className="CertManager-section__title">Certificates that depend on it</h2>
              {entry.dependents.length === 0 ? (
                <p className="CertManager-section__note">
                  No certificate in the namespaces chosen names it.
                </p>
              ) : (
                <div className="CertManager-list">
                  {entry.dependents.map((certificate) => {
                    const status = certificateStatusOf(certificate, now);

                    return (
                      <CertificateRow
                        key={keyOf(certificate)}
                        certificate={certificate}
                        state={status.label}
                        tone={status.tone}
                        meta={certificate.getNs()}
                        aside={describeTimeLeft(certificate, now)}
                        onOpen={() => {
                          onClose();
                          onOpenCertificate(certificate);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </section>

            {entry.issuer && (
              <CommandsSection
                commands={issuerCommands(entry.kind, entry.name, entry.namespace)}
                section="cert-manager-commands"
              />
            )}
          </>
        )}
      </ObjectDrawer>
    );
  },
);

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd className="CertManager-mono">{value}</dd>
    </>
  );
}

export function ServedDrawer({
  served,
  refused,
  onClose,
  onOpenCertificate,
}: {
  served?: ServedTls;
  refused?: SecretsRefusal;
  onClose: () => void;
  onOpenCertificate: (namespace: string, name: string) => void;
}) {
  const leave = (go: () => void) => {
    onClose();
    go();
  };

  return (
    <ObjectDrawer
      open={Boolean(served)}
      kind="Ingress"
      name={served?.ingress ?? ""}
      onClose={onClose}
      state={served ? servedVerdict(served) : undefined}
      section="cert-manager-served"
    >
      {served && (
        <dl className="CertManager-facts">
          <dt>Namespace</dt>
          <dd>{served.namespace}</dd>
          <dt>Hosts</dt>
          <dd>{served.hosts.join(", ") || "Any: the TLS entry names no host"}</dd>
          <dt>Secret</dt>
          <dd>
            {served.state === "unchecked" ? (
              <span>
                {served.secretName}{" "}
                <span className="CertManager-muted">{uncheckedSecretNote(served, refused)}</span>
              </span>
            ) : served.state === "managed" || served.state === "unmanaged" ? (
              <DrawerLink
                title={`Opens the Secrets list narrowed to ${served.secretName}`}
                onClick={() => leave(() => openHostList("/secrets", served.secretName))}
              >
                {served.secretName}
              </DrawerLink>
            ) : (
              <span>
                {served.secretName} <span className="CertManager-muted">(does not exist)</span>
              </span>
            )}
          </dd>
          <dt>Certificate</dt>
          <dd>
            {served.certificate ? (
              <DrawerLink
                title={`Opens ${served.certificate} in the certificates page`}
                onClick={() =>
                  leave(() => onOpenCertificate(served.namespace, served.certificate ?? ""))
                }
              >
                {served.certificate}
              </DrawerLink>
            ) : (
              "None writes this Secret"
            )}
          </dd>
          <dt>Host list</dt>
          <dd>
            <DrawerLink
              title={`Opens the Ingresses list narrowed to ${served.ingress}`}
              onClick={() => leave(() => openHostList("/ingresses", served.ingress))}
            >
              {`${served.ingress} in the Ingresses list`}
            </DrawerLink>
          </dd>
        </dl>
      )}
    </ObjectDrawer>
  );
}

export function SecretDrawer({
  secret,
  certificates,
  ingresses,
  onClose,
}: {
  secret?: SecretLike;
  certificates: CertificateLike[];
  ingresses: IngressLike[];
  onClose: () => void;
}) {
  const leave = (go: () => void) => {
    onClose();
    go();
  };
  const created = parsedTime(secret?.metadata.creationTimestamp);
  const servedBy = secret ? ingressesServing(secret, ingresses) : [];
  const annotations = secret ? annotationsOfInterest(secret) : [];

  return (
    <ObjectDrawer
      open={Boolean(secret)}
      kind="Secret"
      name={secret?.getName() ?? ""}
      onClose={onClose}
      state={secret ? secretVerdict(secret, certificates, ingresses) : undefined}
      section="cert-manager-secret"
    >
      {secret && (
        <dl className="CertManager-facts">
          <dt>Namespace</dt>
          <dd>{secret.getNs()}</dd>
          <dt>Type</dt>
          <dd>{secret.type}</dd>
          <dt>Created</dt>
          <dd>{created === undefined ? "—" : formatUtc(created)}</dd>
          <dt>Served by</dt>
          <dd>
            {servedBy.length === 0
              ? "No Ingress in its namespace"
              : servedBy.map((name, at) => (
                  <span key={name}>
                    {at > 0 && ", "}
                    <DrawerLink
                      title={`Opens the Ingresses list narrowed to ${name}`}
                      onClick={() => leave(() => openHostList("/ingresses", name))}
                    >
                      {name}
                    </DrawerLink>
                  </span>
                ))}
          </dd>
          <dt>cert-manager annotations</dt>
          <dd>
            {annotations.length === 0
              ? "None"
              : annotations.map(([key, value]) => (
                  <div key={key} className="CertManager-mono">
                    {key}: {value}
                  </div>
                ))}
          </dd>
          <dt>Host list</dt>
          <dd>
            <DrawerLink
              title={`Opens the Secrets list narrowed to ${secret.getName()}`}
              onClick={() => leave(() => openHostList("/secrets", secret.getName()))}
            >
              {`${secret.getName()} in the Secrets list`}
            </DrawerLink>
          </dd>
        </dl>
      )}
    </ObjectDrawer>
  );
}
