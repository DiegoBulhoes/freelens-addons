import { observer } from "mobx-react";
import { useState } from "react";

import { runRestartAll } from "../api/actions";
import { masterOf, readyCount } from "../api/nodes";
import { restartAllPlan } from "../api/operations";
import { keyOf, type RedisRow } from "../api/rows";
import { describeLoadState } from "../api/store-state";
import type { RedisKind } from "../api/types";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { useInventory } from "../hooks/use-inventory";
import { RedisDrawer } from "../objects/redis-drawer";

export interface RedisListParams {
  name?: { get(): string };
}

const TITLES: Record<RedisKind, string> = {
  Replication: "Replications",
  Cluster: "Clusters",
  Standalone: "Standalones",
  Sentinel: "Sentinels",
};

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
  ({ kind, params }: { kind: RedisKind; params?: RedisListParams }) => {
    const { stores, rows } = useInventory();
    const [selectedKey, setSelectedKey] = useState<string>();
    const shown = rows.filter((row) => row.kind === kind);
    const selected = rows.find((row) => rowKey(row) === selectedKey);
    const noun = TITLES[kind].toLowerCase();

    return (
      <ListPage
        title={TITLES[kind]}
        subline={
          describeLoadState(stores.state) ??
          "Worst first. A row opens its pods, connection and actions."
        }
        section={`redis-${noun}`}
        rows={shown}
        columns={columnsFor(kind)}
        keyOf={rowKey}
        searchTexts={(row) => [row.object.getName(), row.object.getNs() ?? "", row.health.label]}
        onOpen={(row) => setSelectedKey(rowKey(row))}
        empty={`No ${noun} in the namespaces in scope.`}
        initialQuery={params?.name?.get()}
        selection={{
          hint: "Restarts each ticked one pod by pod, one after another; the rest are listed as skipped.",
          actions: [
            bulkAction<RedisRow>({
              label: "Restart",
              done: "Restarted",
              kind: kind.toLowerCase(),
              tooltip: "Restarts every pod of each ticked one, replicas first and masters last.",
              caution: true,
              nameOf: (row) => row.object.getName(),
              refuse: (row) => {
                const plan = restartAllPlan(row.object, row.nodes);

                return "refused" in plan ? plan.refused : undefined;
              },
              detail:
                "One at a time, each waiting for the last to settle. Keep Freelens open until it ends.",
              run: async (row) => {
                const plan = restartAllPlan(row.object, row.nodes);

                if ("steps" in plan) await runRestartAll(row.object, plan.steps, () => undefined);
              },
            }),
          ],
        }}
      >
        <RedisDrawer
          row={selected}
          rows={rows}
          events={stores.events}
          onClose={() => setSelectedKey(undefined)}
        />
      </ListPage>
    );
  },
);
