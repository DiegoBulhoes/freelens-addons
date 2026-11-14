import type { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";

import type { RouteProps } from "./route-params";

export type ListPageRouteProps = RouteProps & {
  extension: Renderer.LensExtension;
};

/** The open drawer's row key, starting at the one the route names. */
export function useNamedRow(named: string) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(named || undefined);

  // A link from another page names a row while this one is mounted: its drawer opens.
  useEffect(() => {
    if (named) setSelectedKey(named);
  }, [named]);

  return [selectedKey, setSelectedKey] as const;
}

/** The chip the route names, kept in step when a card names another while the page is mounted. */
export function useRequestedFilter<Filter extends string>(
  requested: string,
  isFilter: (value: string) => value is Filter,
  fallback: Filter,
) {
  const [filter, setFilter] = useState<Filter>(isFilter(requested) ? requested : fallback);

  useEffect(() => {
    setFilter(isFilter(requested) ? requested : fallback);
  }, [requested, isFilter, fallback]);

  return [filter, setFilter] as const;
}
