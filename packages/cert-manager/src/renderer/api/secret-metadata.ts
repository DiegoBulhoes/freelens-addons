import type { SecretLike } from "./types";
import { TLS_SECRET_TYPE } from "./unmanaged";

// Metadata only, never the host's secretStore (it loads every private key), and every
// annotation but cert-manager's dropped on arrival: last-applied carries the values.

export const TLS_SECRETS_PATH = `/api/v1/secrets?fieldSelector=${encodeURIComponent(
  `type=${TLS_SECRET_TYPE}`,
)}`;

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
