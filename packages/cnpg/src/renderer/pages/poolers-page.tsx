import { observer } from "mobx-react";
import {
  isPoolerFilter,
  keyOf,
  matchesPoolerFilter,
  type OpenPage,
  POOLER_FILTER_LABELS,
  POOLER_FILTER_TITLES,
  POOLER_FILTERS,
  type PoolerFilter,
} from "../api/shared/navigation";
import { describePoolerReady, poolerReady, poolerVerdict } from "../api/shared/rows";
import { poolerSearchTexts } from "../api/shared/search";
import { emptyText } from "../api/shared/store-state";
import type { PoolerLike } from "../api/shared/types";
import { deletePooler, patchPooler } from "../api/writes/actions";
import { poolerRefusal } from "../api/writes/bulk";
import { pausePatch } from "../api/writes/operations";
import { bulkAction } from "../components/bulk";
import { CellLink } from "../components/drawer-link";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { useNamedRow, useRequestedFilter } from "../hooks/use-list-params";
import { PoolerDrawer } from "./drawers";
import type { ListParams } from "./list-params";
import { poolerActions, RowMenu } from "./row-dialogs";

export const PoolersPage = observer(({ params, open }: { params?: ListParams; open: OpenPage }) => {
  const stores = useCnpgStores("poolers");
  const [selectedKey, setSelectedKey] = useNamedRow(params);
  const [filter, setFilter] = useRequestedFilter(params, isPoolerFilter);
  const selected = stores.poolers.find((pooler) => keyOf(pooler) === selectedKey);
  const verdicts = new Map(
    stores.poolers.map((pooler) => [pooler, poolerVerdict(pooler, stores.clusters, stores.pods)]),
  );
  const verdictOf = (pooler: PoolerLike) =>
    verdicts.get(pooler) ?? poolerVerdict(pooler, stores.clusters, stores.pods);
  const counts = Object.fromEntries(
    POOLER_FILTERS.map((each) => [
      each,
      stores.poolers.filter((pooler) => matchesPoolerFilter(verdictOf(pooler), each)).length,
    ]),
  ) as Record<PoolerFilter, number>;

  const columns: Column<PoolerLike>[] = [
    {
      title: "Pooler",
      className: "CNPG-table__shrink",
      cell: (pooler) => (
        <>
          {pooler.getName()}
          <span className="CNPG-muted"> · {pooler.getNs()}</span>
        </>
      ),
      sortValue: (pooler) => pooler.getName(),
    },
    {
      title: "State",
      className: "CNPG-table__fill",
      cell: (pooler) => {
        const verdict = verdictOf(pooler);

        return <StateCell verdict={verdict} />;
      },
      sortValue: (pooler) => verdictOf(pooler).label,
    },
    {
      title: "Cluster",
      className: "CNPG-table__shrink",
      cell: (pooler) => (
        <CellLink
          title="Opens the cluster"
          onClick={() =>
            open("clusters", { namespace: pooler.getNs(), name: pooler.spec.cluster.name })
          }
        >
          {pooler.spec.cluster.name}
        </CellLink>
      ),
      sortValue: (pooler) => pooler.spec.cluster.name,
    },
    {
      title: "Type",
      className: "CNPG-table__shrink",
      cell: (pooler) => pooler.spec.type ?? "rw",
      sortValue: (pooler) => pooler.spec.type,
    },
    {
      title: "Pool mode",
      className: "CNPG-table__shrink",
      cell: (pooler) => pooler.spec.pgbouncer?.poolMode ?? "session",
      sortValue: (pooler) => pooler.spec.pgbouncer?.poolMode,
    },
    {
      title: "Ready",
      className: "CNPG-table__number",
      cell: (pooler) => describePoolerReady(poolerReady(pooler, stores.pods)),
      sortValue: (pooler) => poolerReady(pooler, stores.pods)?.ready,
    },
  ];

  return (
    <ListPage
      title="Poolers"
      subline={
        stores.load.note ??
        "PgBouncer in front of each cluster. Inactive, with no ready pod, or pointing at a missing cluster is critical."
      }
      alarm={stores.load.alarm}
      section="cnpg-poolers"
      rows={stores.poolers.filter((pooler) => matchesPoolerFilter(verdictOf(pooler), filter))}
      columns={columns}
      keyOf={keyOf}
      searchTexts={(pooler) => poolerSearchTexts(pooler, verdictOf(pooler))}
      filters={
        <FilterChips
          filters={POOLER_FILTERS}
          labels={POOLER_FILTER_LABELS}
          titles={POOLER_FILTER_TITLES}
          counts={counts}
          current={filter}
          onChange={setFilter}
          section="cnpg-pooler-filters"
        />
      }
      onOpen={(pooler) => setSelectedKey(keyOf(pooler))}
      selection={{
        hint: "Each action reaches the ticked poolers it applies to; the rest are listed as skipped.",
        actions: [
          bulkAction<PoolerLike>({
            label: "Start",
            done: "Started",
            kind: "pooler",
            tooltip: "Lets queries through the ticked paused poolers again.",
            nameOf: (pooler) => pooler.getName(),
            refuse: poolerRefusal("start"),
            run: (pooler) => patchPooler(pooler, pausePatch(false)),
          }),
          bulkAction<PoolerLike>({
            label: "Pause",
            done: "Paused",
            kind: "pooler",
            tooltip: "Holds new queries on the ticked poolers, keeping connections open.",
            caution: true,
            nameOf: (pooler) => pooler.getName(),
            refuse: poolerRefusal("pause"),
            run: (pooler) => patchPooler(pooler, pausePatch(true)),
          }),
          bulkAction<PoolerLike>({
            label: "Delete",
            done: "Deleted",
            kind: "pooler",
            tooltip: "Deletes the ticked poolers; connections through them drop.",
            caution: true,
            nameOf: (pooler) => pooler.getName(),
            run: deletePooler,
          }),
        ],
      }}
      menu={(pooler) => <RowMenu actions={poolerActions(pooler)} />}
      empty={emptyText(
        stores.load,
        stores.poolers.length === 0
          ? "No Poolers in the namespaces in scope."
          : "No pooler matches that filter.",
      )}
    >
      <PoolerDrawer
        pooler={selected}
        verdict={selected ? verdictOf(selected) : undefined}
        ready={selected ? poolerReady(selected, stores.pods) : undefined}
        onClose={() => setSelectedKey(undefined)}
        open={open}
      />
    </ListPage>
  );
});
