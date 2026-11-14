import { useEffect, useState } from "react";

import { namedKey } from "../api/shared/navigation";
import type { ListPageRouteProps } from "../pages/list-params";
import { paramText } from "./route-params";

/** The selected row's key, starting at the one the route names; Logical keys carry the kind. */
export function useNamedRow(params: ListPageRouteProps["params"], withKind = false) {
  const key = namedKey(paramText(params, "namespace"), paramText(params, "name"));
  const kind = paramText(params, "kind");
  const named = key && withKind ? (kind ? `${kind}/${key}` : undefined) : key;
  const [selectedKey, setSelectedKey] = useState(named);

  // The page stays mounted when a link names another row.
  useEffect(() => {
    if (named) setSelectedKey(named);
  }, [named]);

  return [selectedKey, setSelectedKey] as const;
}

/** The chip the route names, kept in step when a card names another while the page is mounted. */
export function useRequestedFilter<Filter extends string>(
  params: ListPageRouteProps["params"],
  isFilter: (value: string | undefined) => value is Filter,
) {
  const requested = paramText(params, "filter");
  const [filter, setFilter] = useState<Filter | undefined>(() =>
    isFilter(requested) ? requested : undefined,
  );

  useEffect(() => {
    setFilter(isFilter(requested) ? requested : undefined);
  }, [requested, isFilter]);

  return [filter, setFilter] as const;
}
