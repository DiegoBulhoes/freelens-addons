import { useEffect, useRef, useState } from "react";

import type { Application } from "../api/applications/application";
import { controllerNamespaceOf } from "../api/shared/workload-selection";
import { findArgoCDUrl } from "../api/shared/workloads";

export function useArgoCDUrl(applications: Application[]): string | undefined {
  const [url, setUrl] = useState<string>();
  const tried = useRef<string>();
  const namespace = applications.length > 0 ? controllerNamespaceOf(applications) : undefined;

  // Keyed on the namespace: the applications array is new on every render.
  useEffect(() => {
    if (!namespace || tried.current === namespace) return;

    tried.current = namespace;

    let cancelled = false;
    let settled = false;

    void findArgoCDUrl(namespace).then((found) => {
      settled = true;
      if (!cancelled) setUrl(found);
    });

    return () => {
      cancelled = true;
      // A lookup cut short is tried again on the next run.
      if (!settled) tried.current = undefined;
    };
  }, [namespace]);

  return url;
}
