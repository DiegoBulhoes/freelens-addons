import { useEffect, useState } from "react";

import { namedKey } from "../api/overview/attention";

/** The route params every list page reads; see LIST_PARAMS in index.tsx. */
export interface ListParams {
  kind?: { get(): string };
  namespace?: { get(): string };
  name?: { get(): string };
  filter?: { get(): string };
}

/** The filter and the open drawer a route names, kept in state so the page can change them. */
export function useListRoute<Filter extends string>(
  params: ListParams | undefined,
  isFilter: (value: string | undefined) => value is Filter,
) {
  const requested = params?.filter?.get();
  const [filter, setFilter] = useState<Filter | undefined>(() =>
    isFilter(requested) ? requested : undefined,
  );
  const named = namedKey({
    kind: params?.kind?.get(),
    namespace: params?.namespace?.get(),
    name: params?.name?.get(),
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
