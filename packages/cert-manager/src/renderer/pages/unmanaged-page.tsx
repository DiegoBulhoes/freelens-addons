import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { describeMoment, parsedTime } from "../api/certificates/expiry";
import { bannerFailures } from "../api/shared/listing";
import { keyOf } from "../api/shared/namespace-scope";
import { rowsFor, worstOf } from "../api/shared/store-state";
import { describeCount, searchRows } from "../api/shared/table";
import type { SecretLike } from "../api/shared/types";
import {
  describeServedHeadline,
  getServedTls,
  getUnmanagedSecrets,
  hostsOf,
  isGap,
  isServedFilter,
  matchesServedFilter,
  SERVED_FILTER_LABELS,
  SERVED_FILTER_TITLES,
  SERVED_STATES,
  type ServedTls,
  secretSearchTexts,
  servedEmptyText,
  servedSearchTexts,
  unmanagedSecretsEmptyText,
} from "../api/unmanaged/unmanaged";
import { FilterChips } from "../components/filter-chips";
import { ListingBanner, SecretsRefusedBanner } from "../components/listing-banner";
import { NamespaceFilter } from "../components/namespace-filter";
import { Status } from "../components/status";
import { CertManagerStyles } from "../components/styles";
import { CellLink, type Column, Table } from "../components/table";
import { useCertManagerStores } from "../hooks/use-cert-manager-stores";
import { useRequestedFilter } from "../hooks/use-list-params";
import { useTlsInventory } from "../hooks/use-tls-inventory";
import { openHostList, SecretDrawer, ServedDrawer } from "./drawers";

const servedKey = (entry: ServedTls) => `${entry.namespace}/${entry.ingress}/${entry.secretName}`;

export interface UnmanagedPageParams {
  filter: { get(): string };
}

export const UnmanagedPage = observer(
  ({
    params,
    extension,
  }: {
    params?: UnmanagedPageParams;
    extension: RendererTypes.LensExtension;
  }) => {
    const stores = useCertManagerStores();
    const tls = useTlsInventory();
    const [filter, setFilter] = useRequestedFilter(
      params?.filter.get() ?? "",
      isServedFilter,
      "all",
    );
    const [query, setQuery] = useState("");
    const [openServed, setOpenServed] = useState<string>();
    const [openSecret, setOpenSecret] = useState<string>();
    const now = Date.now();
    const openCertificate = (namespace: string, name: string) =>
      void extension.navigate("certificates", { namespace, name });

    const servedState = worstOf(stores.state, tls.ingressListing.state);
    // A refused Certificate list reads empty, which would make every served Secret a gap.
    const { certificatesKnown } = stores;
    const served = rowsFor(
      servedState,
      certificatesKnown
        ? getServedTls(tls.ingresses, tls.secrets, stores.certificates, tls.secretsListedIn)
        : [],
    );
    const gaps = served.filter(isGap);
    const filtered = served.filter((entry) => matchesServedFilter(entry, filter));
    const unmanagedSecrets = rowsFor(
      stores.state,
      certificatesKnown ? getUnmanagedSecrets(tls.secrets, stores.certificates) : [],
    );
    const shownServed = searchRows(filtered, query, servedSearchTexts);
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
              onClick={() => openHostList("/secrets", entry.secretName)}
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
              onClick={() => openCertificate(entry.namespace, entry.certificate ?? "")}
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
        cell: hostsOf,
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
          const created = parsedTime(secret.metadata.creationTimestamp);

          return created === undefined ? "" : describeMoment(created, now);
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
              {describeServedHeadline(servedState, tls.ingressListing, served, certificatesKnown)}
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

        <ListingBanner
          failed={bannerFailures(stores.failed, tls.ingressListing)}
          gaveUp={stores.gaveUp}
        />

        {tls.secretsRefused && <SecretsRefusedBanner refused={tls.secretsRefused} />}

        <section className="CertManager-section" data-section="served">
          <div className="CertManager-section__bar">
            <h2 className="CertManager-section__title">Served by an Ingress</h2>
            <span className="CertManager-section__note">
              {describeCount(shownServed.length, served.length)}
            </span>
          </div>
          <FilterChips
            labels={SERVED_FILTER_LABELS}
            titles={SERVED_FILTER_TITLES}
            current={filter}
            onChange={setFilter}
            section="served-filters"
          />
          {shownServed.length === 0 ? (
            <p className="CertManager-section__note">
              {query
                ? "Nothing matches the search."
                : served.length > 0
                  ? "Every served TLS Secret has a Certificate."
                  : servedEmptyText(servedState, tls.ingressListing, certificatesKnown)}
            </p>
          ) : (
            <Table
              rows={shownServed}
              columns={servedColumns}
              keyOf={servedKey}
              stateOf={(entry) => entry.state}
              openTitle={(entry) =>
                `Opens ${entry.ingress}: why nothing renews its Secret, or what does`
              }
              onOpen={(entry) => {
                setOpenSecret(undefined);
                setOpenServed(servedKey(entry));
              }}
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
                  : unmanagedSecretsEmptyText(stores.state, certificatesKnown, tls.secretsRefused)}
              </p>
            )
          ) : (
            <Table
              rows={shownSecrets}
              columns={secretColumns}
              keyOf={keyOf}
              openTitle={(secret) =>
                `Opens ${secret.getName()}: why it is unmanaged, and who serves it`
              }
              onOpen={(secret) => {
                setOpenServed(undefined);
                setOpenSecret(keyOf(secret));
              }}
            />
          )}
        </section>

        <ServedDrawer
          served={served.find((entry) => servedKey(entry) === openServed)}
          refused={tls.secretsRefused}
          onClose={() => setOpenServed(undefined)}
          onOpenCertificate={openCertificate}
        />
        <SecretDrawer
          secret={unmanagedSecrets.find((secret) => keyOf(secret) === openSecret)}
          certificates={stores.certificates}
          ingresses={tls.ingresses}
          onClose={() => setOpenSecret(undefined)}
        />
      </div>
    );
  },
);
