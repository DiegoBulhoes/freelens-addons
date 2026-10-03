import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";

import { API_PROXY } from "../api/actions";
import { scopeKey, withinScope } from "../api/namespace-scope";
import {
  METADATA_ONLY,
  type PartialObjectMetadataList,
  TLS_SECRETS_PATH,
  tlsSecretsFrom,
} from "../api/secret-metadata";
import type { IngressLike, SecretLike } from "../api/types";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

const {
  K8sApi: { ingressStore },
} = Renderer;

export interface TlsInventory {
  ingresses: IngressLike[];
  secrets: SecretLike[];
  secretsError?: string;
  secretsLoaded: boolean;
}

export function useTlsInventory(): TlsInventory {
  const [secrets, setSecrets] = useState<SecretLike[]>([]);
  const [secretsError, setSecretsError] = useState<string | undefined>();
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  const scope = useNamespaceScope();

  useLoadedStores([ingressStore], scopeKey(scope));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_PROXY}${TLS_SECRETS_PATH}`, {
          headers: { Accept: METADATA_ONLY },
        });

        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

        // Mapped on arrival: the raw response carries the last-applied annotation's values.
        const listed = tlsSecretsFrom((await response.json()) as PartialObjectMetadataList);

        if (!cancelled) {
          setSecrets(listed);
          setSecretsError(undefined);
        }
      } catch (error) {
        if (!cancelled) setSecretsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setSecretsLoaded(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Secrets are listed cluster-wide, so the scope applies here; Ingresses too, until the reload lands.
  return {
    ingresses: withinScope(ingressStore.items as unknown as IngressLike[], scope),
    secrets: withinScope(secrets, scope),
    secretsError,
    secretsLoaded,
  };
}
