import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";

import { API_PROXY } from "../api/actions";
import {
  METADATA_ONLY,
  type PartialObjectMetadataList,
  TLS_SECRETS_PATH,
  tlsSecretsFrom,
} from "../api/secret-metadata";
import type { IngressLike, SecretLike } from "../api/types";

const {
  K8sApi: { ingressStore },
} = Renderer;

export interface TlsInventory {
  ingresses: IngressLike[];
  secrets: SecretLike[];
  /** Set when TLS Secrets could not be listed — most often, no permission to. */
  secretsError?: string;
  secretsLoaded: boolean;
}

/**
 * Ingresses from the host's store, and TLS Secrets by name only. Pure access:
 * what is managed and what is not is decided in `unmanaged.ts`.
 */
export function useTlsInventory(): TlsInventory {
  const [secrets, setSecrets] = useState<SecretLike[]>([]);
  const [secretsError, setSecretsError] = useState<string | undefined>();
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  useEffect(() => {
    void ingressStore.loadAll({
      onLoadFailure: (error: unknown) =>
        console.warn("[cert-manager] could not list Ingresses", error),
    });

    return ingressStore.subscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_PROXY}${TLS_SECRETS_PATH}`, {
          headers: { Accept: METADATA_ONLY },
        });

        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

        // Mapped the moment it arrives: the raw response still holds every
        // annotation, the last-applied one with its values among them.
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

  return {
    ingresses: ingressStore.items as unknown as IngressLike[],
    secrets,
    secretsError,
    secretsLoaded,
  };
}
