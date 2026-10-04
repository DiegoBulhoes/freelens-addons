import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import { deletePooler, patchPooler } from "../api/actions";
import { poolerRefusal } from "../api/bulk";
import { pausePatch } from "../api/operations";
import { poolerVerdict } from "../api/rows";
import type { PoolerLike } from "../api/types";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useCnpgStores } from "../hooks/use-cnpg-stores";
import { PoolerDrawer } from "./drawers";
import { confirmDeletePooler, confirmPause } from "./row-dialogs";

const {
  Component: { Icon, MenuItem },
} = Renderer;

export const PoolersPage = observer(
  ({ onOpenCluster }: { onOpenCluster: (name: string) => void }) => {
    const stores = useCnpgStores();
    const [selectedKey, setSelectedKey] = useState<string>();
    const selected = stores.poolers.find(
      (pooler) => `${pooler.getNs()}/${pooler.getName()}` === selectedKey,
    );
    const verdictOf = (pooler: PoolerLike) => poolerVerdict(pooler, stores.clusters);

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
          <button
            type="button"
            className="CNPG-link"
            title="Opens the cluster"
            onClick={(event) => {
              event.preventDefault();
              // The row opens a drawer; this link goes to the cluster instead.
              event.stopPropagation();
              onOpenCluster(pooler.spec.cluster.name);
            }}
          >
            {pooler.spec.cluster.name}
          </button>
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
        title: "Instances",
        className: "CNPG-table__number",
        cell: (pooler) => pooler.spec.instances ?? 1,
        sortValue: (pooler) => pooler.spec.instances ?? 1,
      },
    ];

    return (
      <ListPage
        title="Poolers"
        subline="PgBouncer in front of each cluster. Inactive or pointing at a missing cluster is critical."
        section="cnpg-poolers"
        rows={stores.poolers}
        columns={columns}
        keyOf={(pooler) => `${pooler.getNs()}/${pooler.getName()}`}
        searchTexts={(pooler) => [
          pooler.getName(),
          pooler.spec.cluster.name,
          verdictOf(pooler).label,
        ]}
        onOpen={(pooler) => setSelectedKey(`${pooler.getNs()}/${pooler.getName()}`)}
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
        menu={(pooler) => (
          <>
            {pooler.spec.pgbouncer?.paused ? (
              <MenuItem onClick={() => confirmPause(pooler, false)}>
                <Icon material="play_arrow" tooltip="Lets queries through again. Asks first" />
                <span className="title">Start</span>
              </MenuItem>
            ) : (
              <MenuItem onClick={() => confirmPause(pooler, true)}>
                <Icon
                  material="pause"
                  tooltip="Holds new queries, keeping connections open. Asks first"
                />
                <span className="title">Pause</span>
              </MenuItem>
            )}
            <MenuItem onClick={() => confirmDeletePooler(pooler)}>
              <Icon material="delete" tooltip="Deletes the pooler. Asks you to type its name" />
              <span className="title">Delete</span>
            </MenuItem>
          </>
        )}
        empty="No Poolers in the namespaces in scope."
      >
        <PoolerDrawer
          pooler={selected}
          verdict={selected ? poolerVerdict(selected, stores.clusters) : undefined}
          onClose={() => setSelectedKey(undefined)}
          onOpenCluster={(name) => {
            setSelectedKey(undefined);
            onOpenCluster(name);
          }}
        />
      </ListPage>
    );
  },
);
