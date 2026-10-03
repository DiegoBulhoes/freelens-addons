import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { describeMoment } from "../api/expiry";
import { describeCount, searchRows } from "../api/table";
import type { SecretLike } from "../api/types";
import {
  getServedTls,
  getUnmanagedSecrets,
  isGap,
  SERVED_STATES,
  type ServedTls,
  secretSearchTexts,
  servedSearchTexts,
} from "../api/unmanaged";
import { NamespaceFilter } from "../components/namespace-filter";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { CellLink, type Column, Table } from "../components/table";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";
import { useTlsInventory } from "../hooks/use-tls-inventory";

const {
  Navigation: { navigate },
} = Renderer;

// The details drawer cannot open from here, so the host's list is narrowed to the name.
const openList = (path: string, name: string) =>
  navigate(`${path}?search=${encodeURIComponent(name)}`);

export const UnmanagedPage = observer(
  ({ extension }: { extension: RendererTypes.LensExtension }) => {
    const stores = useCertManagerStores();
    const tls = useTlsInventory();
    const [query, setQuery] = useState("");
    const now = Date.now();

    const served = getServedTls(tls.ingresses, tls.secrets, stores.certificates);
    const gaps = served.filter(isGap);
    const unmanagedSecrets = getUnmanagedSecrets(tls.secrets, stores.certificates);
    const shownServed = searchRows(served, query, servedSearchTexts);
    const shownSecrets = searchRows(unmanagedSecrets, query, secretSearchTexts);

    const servedColumns: Column<ServedTls>[] = [
      {
        title: "State",
        className: "CertManager-table__shrink",
        cell: (entry) => (
          <Status tone={SERVED_STATES[entry.state].tone} label={SERVED_STATES[entry.state].label} />
        ),
        sortValue: (entry) => SERVED_STATES[entry.state].rank,
      },
      {
        title: "Ingress",
        className: "CertManager-table__shrink",
        cell: (entry) => entry.ingress,
        sortValue: (entry) => entry.ingress,
      },
      {
        title: "Namespace",
        className: "CertManager-table__shrink",
        cell: (entry) => entry.namespace,
        sortValue: (entry) => entry.namespace,
      },
      {
        title: "Secret",
        className: "CertManager-table__shrink",
        cell: (entry) =>
          entry.state === "managed" || entry.state === "unmanaged" ? (
            <CellLink
              title={`Opens the Secrets list narrowed to ${entry.secretName}`}
              onClick={() => openList("/secrets", entry.secretName)}
            >
              {entry.secretName}
            </CellLink>
          ) : (
            entry.secretName
          ),
        sortValue: (entry) => entry.secretName,
      },
      {
        title: "Certificate",
        className: "CertManager-table__shrink",
        cell: (entry) =>
          entry.certificate ? (
            <CellLink
              title={`Opens ${entry.certificate} in the certificates page`}
              onClick={() =>
                void extension.navigate("certificates", {
                  namespace: entry.namespace,
                  name: entry.certificate ?? "",
                })
              }
            >
              {entry.certificate}
            </CellLink>
          ) : (
            "None"
          ),
        sortValue: (entry) => entry.certificate,
      },
      {
        title: "Hosts",
        className: "CertManager-table__fill",
        cell: (entry) => entry.hosts.join(", "),
      },
    ];

    const secretColumns: Column<SecretLike>[] = [
      {
        title: "Name",
        className: "CertManager-table__fill",
        cell: (secret) => secret.getName(),
        sortValue: (secret) => secret.getName(),
      },
      {
        title: "Namespace",
        className: "CertManager-table__shrink",
        cell: (secret) => secret.getNs(),
        sortValue: (secret) => secret.getNs(),
      },
      {
        title: "Created",
        className: "CertManager-table__shrink",
        cell: (secret) => {
          const created = Date.parse(secret.metadata.creationTimestamp ?? "");

          return Number.isNaN(created) ? "" : describeMoment(created, now);
        },
        sortValue: (secret) => secret.metadata.creationTimestamp,
      },
    ];

    return (
      <div className="CertManager CertManager-page">
        <CertManagerStyles />
        <div className="CertManager-page__head">
          <div>
            <h1 className="CertManager-page__headline">
              {served.length === 0
                ? "No Ingress serves TLS from a Secret"
                : gaps.length === 0
                  ? `All ${served.length} TLS ${served.length === 1 ? "Secret" : "Secrets"} served by an Ingress have a Certificate`
                  : `${gaps.length} of ${served.length} served TLS ${served.length === 1 ? "Secret has" : "Secrets have"} no Certificate`}
            </h1>
            <p
              className={`CertManager-page__subline${gaps.length > 0 ? " CertManager-page__subline--alarm" : ""}`}
            >
              Nothing renews a TLS Secret that no Certificate manages. It works until it expires,
              and cert-manager's lists never show it.
            </p>
          </div>
          <div className="CertManager-page__actions">
            <input
              type="search"
              className="CertManager-search"
              placeholder="Search…"
              aria-label="Search served TLS and TLS Secrets"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <NamespaceFilter />
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

        <section className="CertManager-section" data-section="served">
          <div className="CertManager-section__bar">
            <h2 className="CertManager-section__title">Served by an Ingress</h2>
            <span className="CertManager-section__note">
              {describeCount(shownServed.length, served.length)}
            </span>
          </div>
          {shownServed.length === 0 ? (
            <p className="CertManager-section__note">
              {query
                ? "Nothing matches the search."
                : "No Ingress in the chosen namespaces serves TLS from a Secret."}
            </p>
          ) : (
            <Table
              rows={shownServed}
              columns={servedColumns}
              keyOf={(entry) => `${entry.namespace}/${entry.ingress}/${entry.secretName}`}
              stateOf={(entry) => entry.state}
              openTitle={(entry) => `Opens the Ingresses list narrowed to ${entry.ingress}`}
              onOpen={(entry) => openList("/ingresses", entry.ingress)}
            />
          )}
        </section>

        <section className="CertManager-section" data-section="secrets">
          <div className="CertManager-section__bar">
            <h2 className="CertManager-section__title">TLS Secrets without a Certificate</h2>
            <span className="CertManager-section__note">
              {describeCount(shownSecrets.length, unmanagedSecrets.length)}
            </span>
          </div>
          <p className="CertManager-section__note">
            Served or not. Some belong to other controllers, such as the API server or an admission
            webhook, and need no Certificate. They are listed so nothing is hidden, and not every
            one is a problem.
          </p>
          {shownSecrets.length === 0 ? (
            tls.secretsLoaded && (
              <p className="CertManager-section__note">
                {query
                  ? "Nothing matches the search."
                  : "Every TLS Secret in the chosen namespaces is written by a Certificate."}
              </p>
            )
          ) : (
            <Table
              rows={shownSecrets}
              columns={secretColumns}
              keyOf={(secret) => `${secret.getNs()}/${secret.getName()}`}
              openTitle={(secret) => `Opens the Secrets list narrowed to ${secret.getName()}`}
              onOpen={(secret) => openList("/secrets", secret.getName())}
            />
          )}
        </section>
      </div>
    );
  },
);
