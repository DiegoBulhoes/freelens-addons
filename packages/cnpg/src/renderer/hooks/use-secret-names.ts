import { useEffect, useState } from "react";
import { anyRefused, mergeListings, type SecretListings } from "../api/clusters/secret-metadata";
import { nextReadDelay } from "../api/shared/retry";
import { listSecretNames } from "../api/writes/actions";

/** A namespace is absent until listed; listed again soon after a refusal, slowly otherwise. */
export function useSecretNames(namespaces: string[]): SecretListings | undefined {
  const [listed, setListed] = useState<SecretListings>();
  const joined = namespaces.join(",");

  useEffect(() => {
    if (!joined) return;

    const wanted = joined.split(",");
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const list = async () => {
      const after = await listSecretNames(wanted);

      if (cancelled) return;

      setListed((before) => mergeListings(before, after));
      failures = anyRefused(after) ? failures + 1 : 0;
      timer = setTimeout(() => void list(), nextReadDelay(failures));
    };

    void list();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [joined]);

  return listed;
}
