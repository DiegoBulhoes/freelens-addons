import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import { loadedForScope, loadState } from "../api/shared/store-state";
import type { IngressLike, SecretLike } from "../api/shared/types";
import {
  clusterListings,
  isListedIn,
  listedSecrets,
  METADATA_ONLY,
  mergeListings,
  namespaceTlsSecretsPath,
  type PartialObjectMetadataList,
  type SecretListings,
  secretsRefusal,
  settledListings,
  settleInSlots,
  TLS_SECRETS_PATH,
  tlsSecretsFrom,
} from "../api/unmanaged/secret-metadata";
import type { IngressListing } from "../api/unmanaged/unmanaged";
import { API_PROXY } from "../api/writes/actions";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

const {
  K8sApi: { ingressStore },
} = Renderer;

// Secrets have no store here, so new and deleted ones show up by listing again.
const REFRESH_MS = 30_000;
const TIMEOUT_MS = 10_000;
const NAMESPACE_SLOTS = 4;

class RefusedList extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`${status} ${statusText}`.trim());
    this.status = status;
  }
}

async function listTlsSecrets(path: string): Promise<SecretLike[]> {
  const response = await fetch(`${API_PROXY}${path}`, {
    headers: { Accept: METADATA_ONLY },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new RefusedList(response.status, response.statusText);

  // Mapped on arrival: the raw response carries the last-applied annotation's values.
  return tlsSecretsFrom((await response.json()) as PartialObjectMetadataList);
}

export interface TlsInventory {
  ingresses: IngressLike[];
  ingressListing: IngressListing;
  secrets: SecretLike[];
  /** The namespaces in scope whose Secrets are not known, and why. */
  secretsRefused?: { namespaces: string[]; error: string; everywhere: boolean };
  /** Listed there, and the latest list did not fail: an absent Secret is known to be absent. */
  secretsListedIn: (namespace: string) => boolean;
  /** The first answer has come back, listed or refused. */
  secretsLoaded: boolean;
}

export function useTlsInventory(): TlsInventory {
  const [listings, setListings] = useState<SecretListings>(() => new Map());
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  const scope = useNamespaceScope();
  const key = scopeKey(scope);

  const ingressLoad = useLoadedStores({ Ingress: ingressStore }, key);

  useEffect(() => {
    const namespaces = key ? key.split(",") : [];
    let cancelled = false;
    let inFlight = false;
    // Refused cluster-wide, each namespace may still be listable: asked one by one from then on.
    let perNamespace = false;

    const listEach = async () =>
      settledListings(
        namespaces,
        await settleInSlots(namespaces, NAMESPACE_SLOTS, (namespace) =>
          listTlsSecrets(namespaceTlsSecretsPath(namespace)),
        ),
      );

    const list = async (): Promise<SecretListings> => {
      if (perNamespace) return listEach();

      try {
        return clusterListings(await listTlsSecrets(TLS_SECRETS_PATH), namespaces);
      } catch (error) {
        if (error instanceof RefusedList && (error.status === 401 || error.status === 403)) {
          perNamespace = true;

          return listEach();
        }

        return settledListings(
          namespaces,
          namespaces.map(() => ({ status: "rejected" as const, reason: error })),
        );
      }
    };

    const load = async () => {
      if (inFlight) return;

      inFlight = true;

      try {
        const after = await list();

        if (!cancelled) setListings((before) => mergeListings(before, after));
      } finally {
        inFlight = false;
        if (!cancelled) setSecretsLoaded(true);
      }
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);

  // A cluster-wide list holds every namespace, so the scope applies here; Ingresses too, until the reload lands.
  return {
    ingresses: withinScope(ingressStore.items as unknown as IngressLike[], scope),
    ingressListing: {
      state: loadState({
        registered: true,
        loaded: loadedForScope([ingressStore], ingressLoad.loadedFor, key),
        gaveUp: ingressLoad.gaveUp,
      }),
      refused: ingressLoad.failed.length > 0,
    },
    secrets: withinScope(listedSecrets(listings), scope),
    secretsRefused: secretsRefusal(listings, scope),
    secretsListedIn: (namespace) => isListedIn(listings, namespace),
    secretsLoaded,
  };
}
