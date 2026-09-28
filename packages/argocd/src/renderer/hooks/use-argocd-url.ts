import { useEffect, useState } from "react";

import type { Application } from "../api/application";
import { controllerNamespaceOf, findArgoCDUrl } from "../api/workloads";

export function useArgoCDUrl(applications: Application[]): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (applications.length === 0 || url) return;

    let cancelled = false;

    void findArgoCDUrl(controllerNamespaceOf(applications)).then((found) => {
      if (!cancelled && found) setUrl(found);
    });

    return () => {
      cancelled = true;
    };
  }, [applications, url]);

  return url;
}
