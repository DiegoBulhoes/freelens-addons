import { observer } from "mobx-react";

import {
  INSTANCE_FILTER_TITLES,
  type InstanceFilter,
  type InstanceRow,
  isInstanceFilter,
  matchesInstanceFilter,
} from "../api/instances/instances";
import { describeLoadState } from "../api/shared/store-state";
import { worstFirst } from "../api/shared/verdict";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useInventory } from "../hooks/use-inventory";
import { InstanceDrawer } from "../instances/instance-drawer";
import { type ListParams, useListRoute } from "./list-params";

const FILTERS = ["attention"] as const;
const LABELS: Record<InstanceFilter, string> = { attention: "Needs attention" };

const COLUMNS: Column<InstanceRow>[] = [
  {
    title: "Name",
    className: "Prometheus-table__shrink",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    title: "Namespace",
    className: "Prometheus-table__shrink",
    cell: (row) => row.namespace,
    sortValue: (row) => row.namespace,
  },
  {
    title: "Kind",
    className: "Prometheus-table__shrink",
    cell: (row) => row.kind,
    sortValue: (row) => row.kind,
  },
  {
    title: "Ready",
    className: "Prometheus-table__number",
    cell: (row) => `${row.ready}/${row.desired}`,
    sortValue: (row) => row.ready,
  },
  {
    title: "Shards",
    className: "Prometheus-table__number",
    cell: (row) => (row.kind === "Alertmanager" ? "—" : row.shards),
    sortValue: (row) => (row.kind === "Alertmanager" ? undefined : row.shards),
  },
  {
    title: "Alertmanagers",
    className: "Prometheus-table__shrink",
    cell: (row) => row.alertmanagers.join(", ") || "—",
    sortValue: (row) => row.alertmanagers.join(", ") || undefined,
  },
  {
    title: "State",
    className: "Prometheus-table__fill",
    cell: (row) => <StateCell verdict={row.verdict} />,
    sortValue: (row) => row.verdict.label,
  },
];

export const InstancesPage = observer(({ params }: { params?: ListParams }) => {
  const { stores, instances, live } = useInventory({
    monitors: false,
    rules: false,
    alerting: true,
  });
  const { filter, setFilter, selectedKey, setSelectedKey } = useListRoute(params, isInstanceFilter);
  const selected = instances.find((row) => row.key === selectedKey);

  return (
    <ListPage
      live={live}
      title="Instances"
      subline={
        describeLoadState(stores.state) ??
        "Prometheuses, agents and Alertmanagers the operator runs, worst first. A row opens its conditions and shards."
      }
      section="prometheus-instances"
      rows={worstFirst(instances.filter((row) => matchesInstanceFilter(row, filter)))}
      columns={COLUMNS}
      keyOf={(row) => row.key}
      searchTexts={(row) => [row.name, row.namespace, row.kind, row.verdict.label]}
      onOpen={(row) => setSelectedKey(row.key)}
      empty={
        instances.length === 0
          ? "No Prometheus, PrometheusAgent or Alertmanager in the namespaces in scope."
          : "No instance matches that filter."
      }
      initialQuery={params?.name?.get()}
      filters={
        <FilterChips
          filters={FILTERS}
          labels={LABELS}
          titles={INSTANCE_FILTER_TITLES}
          counts={{
            attention: instances.filter((row) => matchesInstanceFilter(row, "attention")).length,
          }}
          current={filter}
          onChange={setFilter}
          section="prometheus-instance-filters"
        />
      }
    >
      <InstanceDrawer row={selected} onClose={() => setSelectedKey(undefined)} />
    </ListPage>
  );
});
