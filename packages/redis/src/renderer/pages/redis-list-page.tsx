import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { masterOf, readyCount } from "../api/objects/nodes";
import {
  bulkRestartRefusal,
  filterOf,
  filtersFor,
  keyOf,
  matchesFilter,
  namedKey,
  type RedisRow,
  type RowFilter,
} from "../api/objects/rows";
import { KIND_TITLES, type OpenPage } from "../api/shared/navigation";
import { emptyText, pageNote } from "../api/shared/store-state";
import type { RedisKind } from "../api/shared/types";
import { freshPlan } from "../api/writes/actions";
import { BULK_RESTART_TOOLTIP } from "../api/writes/operations";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { RowFilters } from "../components/row-filters";
import { Status } from "../components/status";
import { useInventory } from "../hooks/use-inventory";
import { restartWithProgress } from "../objects/dialogs";
import { RedisDrawer } from "../objects/redis-drawer";

export interface RedisListParams {
  namespace?: { get(): string };
  name?: { get(): string };
  filter?: { get(): string };
}

const rowKey = (row: RedisRow) => keyOf(row.object);

function columnsFor(kind: RedisKind): Column<RedisRow>[] {
  return [
    {
      title: "Name",
      className: "Redis-table__shrink",
      cell: (row) => (
        <>
          {row.object.getName()}
          <span className="Redis-muted"> · {row.object.getNs()}</span>
        </>
      ),
      sortValue: (row) => row.object.getName(),
    },
    {
      title: "State",
      className: "Redis-table__fill",
      cell: (row) => (
        <span className="Redis-truncate" title={row.health.reason}>
          <Status tone={row.health.tone} label={row.health.label} />
          {row.health.tone !== "ok" && <span className="Redis-muted"> · {row.health.reason}</span>}
        </span>
      ),
      sortValue: (row) => row.health.label,
    },
    {
      title: "Pods",
      className: "Redis-table__number",
      cell: (row) => {
        const { ready, wanted } = readyCount(row.object, row.nodes);

        return `${ready}/${wanted}`;
      },
      sortValue: (row) => readyCount(row.object, row.nodes).ready,
    },
    ...(kind === "Replication"
      ? [
          {
            title: "Master",
            className: "Redis-table__shrink" as const,
            cell: (row: RedisRow) => masterOf(row.nodes)?.name ?? "—",
            sortValue: (row: RedisRow) => masterOf(row.nodes)?.name,
          },
          {
            title: "Sentinels",
            className: "Redis-table__shrink" as const,
            cell: (row: RedisRow) =>
              row.related.map((each) => each.getName()).join(", ") || (
                <span className="Redis-muted">None</span>
              ),
            sortValue: (row: RedisRow) => row.related.length,
          },
        ]
      : []),
    ...(kind === "Sentinel"
      ? [
          {
            title: "Watches",
            className: "Redis-table__shrink" as const,
            cell: (row: RedisRow) =>
              row.object.spec.redisSentinelConfig?.redisReplicationName ?? "—",
            sortValue: (row: RedisRow) => row.object.spec.redisSentinelConfig?.redisReplicationName,
          },
        ]
      : []),
    {
      title: "TLS",
      className: "Redis-table__shrink",
      cell: (row) =>
        row.tls.enabled ? (
          <span title={`Secret ${row.tls.secret}`}>
            On{row.tls.certManager && <span className="Redis-muted"> · cert-manager</span>}
          </span>
        ) : (
          <span className="Redis-muted">Off</span>
        ),
      sortValue: (row) => (row.tls.enabled ? (row.tls.certManager ? 2 : 1) : 0),
    },
    {
      title: "Image",
      className: "Redis-table__shrink",
      cell: (row) => (
        <span className="Redis-muted">
          {row.object.spec.kubernetesConfig?.image?.split(":").at(-1) ?? "—"}
        </span>
      ),
      sortValue: (row) => row.object.spec.kubernetesConfig?.image,
    },
  ];
}

export const RedisListPage = observer(
  ({ kind, params, open }: { kind: RedisKind; params?: RedisListParams; open: OpenPage }) => {
    const { stores, rows } = useInventory();
    const requested = params?.filter?.get();
    const [filter, setFilter] = useState<RowFilter>(() => filterOf(kind, requested));
    const named = namedKey(kind, {
      namespace: params?.namespace?.get(),
      name: params?.name?.get(),
    });
    const [selectedKey, setSelectedKey] = useState(named);
    const kindRows = rows.filter((row) => row.kind === kind);
    const selected = rows.find((row) => rowKey(row) === selectedKey);
    const noun = KIND_TITLES[kind].toLowerCase();
    const tooltip = BULK_RESTART_TOOLTIP[kind];
    const { note, alarm } = pageNote(stores.state, stores.failures);

    // The page stays mounted when a card names another filter.
    useEffect(() => {
      setFilter(filterOf(kind, requested));
    }, [kind, requested]);

    // An attention row or a drawer link names an object: its drawer opens.
    useEffect(() => {
      if (named) setSelectedKey(named);
    }, [named]);

    return (
      <ListPage
        title={KIND_TITLES[kind]}
        subline={note ?? "Worst first. A row opens its pods, connection and actions."}
        alarm={alarm}
        section={`redis-${noun}`}
        rows={kindRows.filter((row) => matchesFilter(row, filter))}
        columns={columnsFor(kind)}
        keyOf={rowKey}
        searchTexts={(row) => [row.object.getName(), row.object.getNs() ?? "", row.health.label]}
        onOpen={(row) => setSelectedKey(rowKey(row))}
        empty={
          kindRows.length === 0
            ? emptyText(stores.state, `No ${noun} in the namespaces in scope.`)
            : "None of those."
        }
        filters={<RowFilters filters={filtersFor(kind)} current={filter} onChange={setFilter} />}
        // A cluster would refuse every restart: no selection to tick.
        selection={
          tooltip
            ? {
                hint: "Restarts each ticked one pod by pod, one after another; the rest are listed as skipped.",
                actions: [
                  bulkAction<RedisRow>({
                    label: "Restart",
                    done: "Restarted",
                    kind: kind.toLowerCase(),
                    tooltip,
                    caution: true,
                    nameOf: (row) => row.object.getName(),
                    refuse: bulkRestartRefusal,
                    detail:
                      "One at a time, each waiting for the last to settle. Keep Freelens open until it ends.",
                    run: async (row) =>
                      restartWithProgress(row.object, await freshPlan(row.object)),
                  }),
                ],
              }
            : undefined
        }
      >
        <RedisDrawer
          row={selected}
          rows={rows}
          open={open}
          onClose={() => setSelectedKey(undefined)}
        />
      </ListPage>
    );
  },
);
