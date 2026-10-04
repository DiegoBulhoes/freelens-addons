import { useEffect, useState } from "react";

import { listSecretNames } from "../api/actions";
import type { SecretMetaLike } from "../api/types";

/** Names of the Secrets in these namespaces; undefined until listed or if listing is refused. */
export function useSecretNames(namespaces: string[]): SecretMetaLike[] | undefined {
  const [names, setNames] = useState<SecretMetaLike[]>();
  const joined = namespaces.join(",");

  useEffect(() => {
    let cancelled = false;

    if (!joined) return;

    void listSecretNames(joined.split(","))
      .then((listed) => {
        if (!cancelled) setNames(listed);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [joined]);

  return names;
}
