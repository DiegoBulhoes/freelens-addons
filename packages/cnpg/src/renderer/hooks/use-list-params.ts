import { useEffect, useState } from "react";

import { namedKey } from "../api/shared/navigation";
import type { ListParams } from "../pages/list-params";

/** The selected row's key, starting at the one the route names; Logical keys carry the kind. */
export function useNamedRow(params: ListParams | undefined, withKind = false) {
  const key = namedKey(params?.namespace?.get(), params?.name?.get());
  const kind = params?.kind?.get();
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
  params: ListParams | undefined,
  isFilter: (value: string | undefined) => value is Filter,
) {
  const requested = params?.filter?.get();
  const [filter, setFilter] = useState<Filter | undefined>(() =>
    isFilter(requested) ? requested : undefined,
  );

  useEffect(() => {
    setFilter(isFilter(requested) ? requested : undefined);
  }, [requested, isFilter]);

  return [filter, setFilter] as const;
}
