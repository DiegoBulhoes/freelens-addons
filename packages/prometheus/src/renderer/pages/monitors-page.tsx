import { observer } from "mobx-react";
import {
  isMonitorFilter,
  MONITOR_FILTER_TITLES,
  MONITOR_FILTERS,
  type MonitorFilter,
  type MonitorRow,
  matchesMonitorFilter,
} from "../api/monitors/monitors";
import type { OpenPage } from "../api/overview/attention";
import { describeLive, describeTarget, shortSourceNames } from "../api/shared/facts";
import { monitorFixes } from "../api/shared/fixes";
import { describeRefusedEvents } from "../api/shared/rejections";
import { namespaceLabelsOf } from "../api/shared/selection";
import { describeLoadState } from "../api/shared/store-state";
import { worstFirst } from "../api/shared/verdict";
import { FixMenuItems } from "../components/commands-section";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useInventory } from "../hooks/use-inventory";
import { MonitorDrawer } from "../monitors/monitor-drawer";
import { type ListParams, useListRoute } from "./list-params";

const LABELS: Record<MonitorFilter, string> = {
  attention: "Needs attention",
  "not-selected": "Not selected",
  "no-target": "No target",
  down: "Down",
  rejected: "Rejected or not loaded",
  healthy: "Healthy",
  unknown: "Unknown",
};

const COLUMNS: Column<MonitorRow>[] = [
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
    title: "Selected by",
    className: "Prometheus-table__shrink",
    cell: (row) => shortSourceNames(row.selection.selectedBy),
    sortValue: (row) => shortSourceNames(row.selection.selectedBy),
  },
  {
    title: "Target",
    className: "Prometheus-table__shrink",
    cell: describeTarget,
    sortValue: describeTarget,
  },
  {
    title: "Live",
    className: "Prometheus-table__shrink",
    cell: describeLive,
    sortValue: (row) => row.health?.down,
  },
  {
    title: "State",
    className: "Prometheus-table__fill",
    cell: (row) => <StateCell verdict={row.verdict} />,
    sortValue: (row) => row.verdict.label,
  },
];

interface MonitorsPageProps {
  params?: ListParams;
  open: OpenPage;
}

export const MonitorsPage = observer(({ params, open }: MonitorsPageProps) => {
  const { stores, monitors, eventsRefused, live } = useInventory({ monitors: true, rules: false });
  const { filter, setFilter, selectedKey, setSelectedKey } = useListRoute(params, isMonitorFilter);
  const selected = monitors.find((row) => row.key === selectedKey);
  const namespaceLabels = namespaceLabelsOf(stores.namespaces);
  const fixesOf = (row: MonitorRow) => monitorFixes(row, stores.sources, namespaceLabels);
  const counts = Object.fromEntries(
    MONITOR_FILTERS.map((each) => [
      each,
      monitors.filter((row) => matchesMonitorFilter(row, each)).length,
    ]),
  ) as Record<MonitorFilter, number>;

  return (
    <ListPage
      live={live}
      title="Monitors"
      subline={[
        describeLoadState(stores.state) ??
          "ServiceMonitors, PodMonitors and ScrapeConfigs, worst first. A row opens who selects it, what it reaches and what Prometheus says.",
        describeRefusedEvents(eventsRefused),
      ]
        .filter(Boolean)
        .join(" ")}
      section="prometheus-monitors"
      rows={worstFirst(monitors.filter((row) => matchesMonitorFilter(row, filter)))}
      columns={COLUMNS}
      keyOf={(row) => row.key}
      searchTexts={(row) => [
        row.name,
        row.namespace,
        row.kind,
        shortSourceNames(row.selection.selectedBy),
        row.verdict.label,
      ]}
      onOpen={(row) => setSelectedKey(row.key)}
      empty={
        monitors.length === 0
          ? "No ServiceMonitor, PodMonitor or ScrapeConfig in the namespaces in scope."
          : "No monitor matches that filter."
      }
      initialQuery={params?.name?.get()}
      filters={
        <FilterChips
          filters={MONITOR_FILTERS}
          labels={LABELS}
          titles={MONITOR_FILTER_TITLES}
          counts={counts}
          current={filter}
          onChange={setFilter}
          section="prometheus-monitor-filters"
        />
      }
      menu={(row) => <FixMenuItems fixes={fixesOf(row)} />}
    >
      <MonitorDrawer
        row={selected}
        fixes={selected ? fixesOf(selected) : []}
        onClose={() => setSelectedKey(undefined)}
        open={open}
      />
    </ListPage>
  );
});
