import { useEffect, useState } from "react";

import { isReplicaSetFilter, namedKey, type ReplicaSetFilter } from "../api/shared/navigation";
import { paramText, type RouteProps } from "./route-params";

type Params = RouteProps["params"];

/** The list page's props: the route params LIST_PARAMS in index.tsx declares. */
export type ReplicaSetsPageProps = RouteProps;

/** The open drawer's row key, starting at the one the route names. */
export function useNamedRow(params: Params) {
  const named = namedKey(paramText(params, "namespace"), paramText(params, "name"));
  const [selectedKey, setSelectedKey] = useState(named);

  // The page stays mounted when a link names another cluster.
  useEffect(() => {
    if (named) setSelectedKey(named);
  }, [named]);

  return [selectedKey, setSelectedKey] as const;
}

/** The chip the route names, kept in step when a card names another while the page is mounted. */
export function useRequestedFilter(params: Params) {
  const requested = paramText(params, "filter");
  const [filter, setFilter] = useState<ReplicaSetFilter | undefined>(() =>
    isReplicaSetFilter(requested) ? requested : undefined,
  );

  useEffect(() => {
    setFilter(isReplicaSetFilter(requested) ? requested : undefined);
  }, [requested]);

  return [filter, setFilter] as const;
}
