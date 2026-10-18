import { useEffect, useRef, useState } from "react";

// getStore() throws until Freelens registers the CRD's API, a moment after the cluster connects.
export function useKubeStore<T>(get: () => T): T | undefined {
  const [store, setStore] = useState<T | undefined>(() => attempt(get));

  // `get` is a fresh closure every render; the ref keeps it out of the effect's deps.
  const latest = useRef(get);
  latest.current = get;

  useEffect(() => {
    if (store) return;

    const timer = setInterval(() => {
      const resolved = attempt(latest.current);

      if (resolved) setStore(() => resolved);
    }, 500);

    return () => clearInterval(timer);
  }, [store]);

  return store;
}

function attempt<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}
