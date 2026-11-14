import { useEffect, useState } from "react";

import { namedKey } from "../api/overview/attention";
import { paramText, type RouteProps } from "../hooks/route-params";

/** The route params every list page reads; see LIST_PARAMS in index.tsx. */
export type ListParams = RouteProps["params"];

/** The filter and the open drawer a route names, kept in state so the page can change them. */
export function useListRoute<Filter extends string>(
  params: ListParams,
  isFilter: (value: string | undefined) => value is Filter,
) {
  const requested = paramText(params, "filter");
  const [filter, setFilter] = useState<Filter | undefined>(() =>
    isFilter(requested) ? requested : undefined,
  );
  const named = namedKey({
    kind: paramText(params, "kind"),
    namespace: paramText(params, "namespace"),
    name: paramText(params, "name"),
  });
  const [selectedKey, setSelectedKey] = useState(named);

  // An attention row or a drawer link names a row: its drawer opens.
  useEffect(() => {
    if (named) setSelectedKey(named);
  }, [named]);

  // The page stays mounted when a card names another filter.
  useEffect(() => {
    setFilter(isFilter(requested) ? requested : undefined);
  }, [requested, isFilter]);

  return { filter, setFilter, selectedKey, setSelectedKey };
}
