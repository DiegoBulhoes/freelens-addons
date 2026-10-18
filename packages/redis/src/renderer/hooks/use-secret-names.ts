import { useEffect, useState } from "react";
import { anyRefused, mergeListings, type SecretListings } from "../api/objects/upkeep";
import { nextReadDelay } from "../api/shared/retry";
import { listSecretNames } from "../api/writes/actions";

/** A namespace is absent until listed; relisted soon after a refusal, slowly otherwise, so a new issuer shows. */
export function useSecretNames(namespaces: string[]): SecretListings {
  const [listed, setListed] = useState<SecretListings>(new Map());
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
