import { useEffect, useState } from "react";

import { isReplicaSetFilter, namedKey, type ReplicaSetFilter } from "../api/shared/navigation";
import type { ReplicaSetsPageParams } from "../pages/replica-sets-page";

/** The open drawer's row key, starting at the one the route names. */
export function useNamedRow(params: ReplicaSetsPageParams | undefined) {
  const named = namedKey(params?.namespace?.get(), params?.name?.get());
  const [selectedKey, setSelectedKey] = useState(named);

  // The page stays mounted when a link names another cluster.
  useEffect(() => {
    if (named) setSelectedKey(named);
  }, [named]);

  return [selectedKey, setSelectedKey] as const;
}

/** The chip the route names, kept in step when a card names another while the page is mounted. */
export function useRequestedFilter(params: ReplicaSetsPageParams | undefined) {
  const requested = params?.filter?.get();
  const [filter, setFilter] = useState<ReplicaSetFilter | undefined>(() =>
    isReplicaSetFilter(requested) ? requested : undefined,
  );

  useEffect(() => {
    setFilter(isReplicaSetFilter(requested) ? requested : undefined);
  }, [requested]);

  return [filter, setFilter] as const;
}
