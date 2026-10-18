import { useEffect, useState } from "react";
import { anyRefused, type SecretNames, settledSecretNames } from "../api/clusters/upkeep";
import { nextReadDelay } from "../api/shared/retry";
import { listSecretNames } from "../api/writes/actions";

/** Undefined until any listing returns; a refused namespace is listed again soon, the rest slowly. */
export function useSecretNames(namespaces: string[]): SecretNames | undefined {
  const [names, setNames] = useState<SecretNames>();
  const joined = namespaces.join(",");

  useEffect(() => {
    if (!joined) return;

    const wanted = joined.split(",");
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const list = async () => {
      const results = await listSecretNames(wanted);

      if (cancelled) return;

      setNames((before) => settledSecretNames(wanted, results, before));
      failures = anyRefused(results) ? failures + 1 : 0;
      timer = setTimeout(() => void list(), nextReadDelay(failures));
    };

    void list();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [joined]);

  return names;
}
