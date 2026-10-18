import { useEffect, useState } from "react";
import type { WarningsRead } from "../api/clusters/upkeep";
import { reasonOf } from "../api/shared/errors";
import { nextReadDelay, WARNINGS_RELIST_MS } from "../api/shared/retry";
import { listWarningEvents } from "../api/writes/actions";

/** The namespace's Warning events, listed while mounted, every 30s and sooner after a failure. */
export function useWarningEvents(namespace: string | undefined): WarningsRead {
  const [read, setRead] = useState<WarningsRead>({});

  useEffect(() => {
    setRead({});
    if (!namespace) return;

    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const list = async () => {
      try {
        const events = await listWarningEvents(namespace);

        failures = 0;
        if (cancelled) return;
        setRead({ events });
      } catch (error) {
        failures += 1;
        if (cancelled) return;
        setRead((known) => ({ events: known.events, error: reasonOf(error) }));
      }
      timer = setTimeout(() => void list(), nextReadDelay(failures, WARNINGS_RELIST_MS));
    };

    void list();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [namespace]);

  return read;
}
