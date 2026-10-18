import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import {
  type CollectorRow,
  collectorSearchTexts,
  describeReady,
} from "../api/collectors/collectors";
import { namedKey } from "../api/overview/attention";
import { describeLoadState } from "../api/shared/store-state";
import { CollectorDrawer } from "../collectors/collector-drawer";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useInventory } from "../hooks/use-inventory";

export interface CollectorsParams {
  namespace?: { get(): string };
  name?: { get(): string };
}

const COLUMNS: Column<CollectorRow>[] = [
  {
    title: "Name",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    title: "Namespace",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.namespace,
    sortValue: (row) => row.namespace,
  },
  {
    title: "Mode",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.mode,
    sortValue: (row) => row.mode,
  },
  {
    title: "Ready",
    className: "OpenTelemetry-table__number",
    cell: describeReady,
    sortValue: (row) => row.replicas?.ready ?? row.pods.length,
  },
  {
    title: "Version",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.version ?? "—",
    sortValue: (row) => row.version,
  },
  {
    title: "Target allocator",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => (row.targetAllocator ? "On" : <span className="OpenTelemetry-muted">Off</span>),
    sortValue: (row) => Number(row.targetAllocator),
  },
  {
    title: "State",
    className: "OpenTelemetry-table__fill",
    cell: (row) => <StateCell verdict={row.verdict} />,
    sortValue: (row) => row.verdict.label,
  },
];

export const CollectorsPage = observer(({ params }: { params?: CollectorsParams }) => {
  const { stores, collectors } = useInventory({ collectors: true, coverage: false });
  const named = namedKey("collectors", {
    namespace: params?.namespace?.get(),
    name: params?.name?.get(),
  });
  const [selectedKey, setSelectedKey] = useState(named);
  const selected = collectors.find((row) => row.key === selectedKey);

  // An attention row names a collector: its drawer opens.
  useEffect(() => {
    if (named) setSelectedKey(named);
  }, [named]);

  return (
    <ListPage
      title="Collectors"
      subline={
        describeLoadState(stores.collectorState) ??
        "Worst first. Ready counts the pods, not the Ready condition. A row opens its pods and why one exits."
      }
      section="opentelemetry-collectors"
      rows={collectors}
      columns={COLUMNS}
      keyOf={(row) => row.key}
      searchTexts={collectorSearchTexts}
      onOpen={(row) => setSelectedKey(row.key)}
      empty="No OpenTelemetryCollector in the namespaces in scope."
    >
      <CollectorDrawer row={selected} onClose={() => setSelectedKey(undefined)} />
    </ListPage>
  );
});
