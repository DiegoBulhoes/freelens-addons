import { useEffect, useState } from "react";
import { nextWarnings, type WarningsRead } from "../api/objects/upkeep";
import { reasonOf } from "../api/shared/errors";
import { nextReadDelay } from "../api/shared/retry";
import { listWarningEvents } from "../api/writes/actions";

/** The namespace's warnings while a drawer shows them; undefined namespace reads nothing. */
export function useWarningEvents(namespace: string | undefined): WarningsRead | undefined {
  const [read, setRead] = useState<{ namespace: string; read: WarningsRead }>();

  useEffect(() => {
    if (!namespace) return;

    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const list = async () => {
      let result: WarningsRead;

      try {
        result = { events: await listWarningEvents(namespace) };
        failures = 0;
      } catch (error) {
        result = { error: reasonOf(error) };
        failures += 1;
      }
      if (cancelled) return;

      setRead((before) => ({
        namespace,
        read: before?.namespace === namespace ? nextWarnings(before.read, result) : result,
      }));
      timer = setTimeout(() => void list(), nextReadDelay(failures));
    };

    void list();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [namespace]);

  return namespace && read?.namespace === namespace ? read.read : undefined;
}
