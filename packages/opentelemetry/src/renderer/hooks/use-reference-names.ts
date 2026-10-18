import { useEffect, useState } from "react";
import { anyRefused, mergeListings, type ReferenceNames } from "../api/coverage/reference-names";
import { nextReadDelay } from "../api/shared/retry";
import { listConfigMapNames, listSecretNames } from "../api/writes/actions";

/** A namespace is absent until listed; relisted soon after a refusal, slowly otherwise, so new Secrets show. */
export function useReferenceNames(namespaces: string[]): ReferenceNames {
  const [listed, setListed] = useState<ReferenceNames>({});
  const joined = namespaces.join(",");

  useEffect(() => {
    if (!joined) return;

    const wanted = joined.split(",");
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const list = async () => {
      const [secrets, configMaps] = await Promise.all([
        listSecretNames(wanted),
        listConfigMapNames(wanted),
      ]);

      if (cancelled) return;

      setListed((before) => ({
        secrets: mergeListings(before.secrets, secrets),
        configMaps: mergeListings(before.configMaps, configMaps),
      }));
      failures = anyRefused(secrets, configMaps) ? failures + 1 : 0;
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
