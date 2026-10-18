import { useEffect, useState } from "react";
import { type OperatorList, rememberedOperator, rememberOperator } from "../api/coverage/operator";
import { reasonOf } from "../api/shared/errors";
import { nextReadDelay } from "../api/shared/retry";
import { listOperatorDeployments } from "../api/writes/actions";

/** Undefined until read or when not wanted; read again when `versions` changes and after a refusal. */
export function useOperator(wanted: boolean, versions: string): OperatorList | undefined {
  const [read, setRead] = useState<{ versions: string; list: OperatorList }>();

  useEffect(() => {
    if (!wanted) return;

    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const list = async () => {
      let result: OperatorList;

      try {
        result = { items: await listOperatorDeployments() };
      } catch (error) {
        result = { error: reasonOf(error) };
      }
      if (cancelled) return;

      rememberOperator(versions, result);
      setRead({ versions, list: result });
      if ("items" in result) return;

      failures += 1;
      timer = setTimeout(() => void list(), nextReadDelay(failures));
    };

    void list();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wanted, versions]);

  if (!wanted) return undefined;

  // Until the new versions are read, the last list stands in rather than Checking.
  return read?.versions === versions ? read.list : (rememberedOperator(versions) ?? read?.list);
}
