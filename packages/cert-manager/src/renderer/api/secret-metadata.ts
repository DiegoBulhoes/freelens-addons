import type { SecretLike } from "./types";
import { TLS_SECRET_TYPE } from "./unmanaged";

/**
 * TLS Secrets, as the extension is allowed to hold them: names and cert-manager's
 * annotations, and nothing else.
 *
 * The host's own Secret store lists Secrets with their data, so reading it would
 * put every private key in the cluster into this renderer each time a page
 * mounted. Instead the list is requested as metadata only — the API server's
 * PartialObjectMetadataList, which carries no `data` — and filtered to TLS
 * Secrets by field selector.
 *
 * That is not enough on its own. `kubectl apply` records the whole manifest it
 * applied, values included, in the last-applied annotation, and annotations are
 * metadata. So every annotation but cert-manager's is dropped here, the moment
 * the response arrives, before anything else can keep a reference to it.
 */

export const TLS_SECRETS_PATH = `/api/v1/secrets?fieldSelector=${encodeURIComponent(
  `type=${TLS_SECRET_TYPE}`,
)}`;

/** The Accept header that makes the API server leave out everything but metadata. */
export const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";

const KEPT_ANNOTATION = "cert-manager.io/";

interface PartialMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  annotations?: Record<string, string>;
}

export interface PartialObjectMetadataList {
  items?: { metadata?: PartialMetadata }[];
}

export function tlsSecretsFrom(list: PartialObjectMetadataList): SecretLike[] {
  return (list.items ?? []).flatMap((item) => {
    const metadata = item.metadata;

    if (!metadata?.name) return [];

    const annotations = Object.fromEntries(
      Object.entries(metadata.annotations ?? {}).filter(([key]) => key.startsWith(KEPT_ANNOTATION)),
    );
    const name = metadata.name;
    const namespace = metadata.namespace;

    return [
      {
        getName: () => name,
        getNs: () => namespace,
        type: TLS_SECRET_TYPE,
        metadata: {
          uid: metadata.uid,
          creationTimestamp: metadata.creationTimestamp,
          annotations,
        },
      },
    ];
  });
}
