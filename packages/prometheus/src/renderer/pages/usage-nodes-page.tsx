import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import type { NodeLike } from "../api/shared/types";
import {
  describeShare,
  describeValue,
  formatBytes,
  formatCores,
  formatRate,
} from "../api/shared/units";
import { groupedDatasets } from "../api/usage/series";
import {
  chartNote,
  chartQueries,
  hasUsageData,
  NODE_CHARTS,
  type NodeRow,
  nodeKeyOf,
  nodeRows,
  type UsageMetrics,
  usageState,
  usageVerdict,
} from "../api/usage/usage";
import { keepChosen, nodeChoices, stillOffered } from "../api/usage/usage-filters";
import {
  CURRENT_WINDOW,
  chartWindow,
  isFirstAsk,
  NODE_CHOICES,
  nodeQueries,
  podQueries,
  usageSubline,
} from "../api/usage/usage-queries";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { UsageChart } from "../components/usage-chart";
import { useLoadedStores } from "../hooks/load-stores";
import { useMetrics, useNodeLabel } from "../hooks/use-metrics";
import {
  ChoiceFilter,
  RefreshButton,
  UsageControls,
  UsageNotice,
  useChosenNodes,
  useRefresh,
  useUsagePeriod,
} from "../usage/controls";
import { NodeUsageDrawer } from "../usage/node-usage-drawer";

const diskIo = (row: NodeRow) =>
  row.diskRead === undefined && row.diskWritten === undefined
    ? undefined
    : (row.diskRead ?? 0) + (row.diskWritten ?? 0);

const COLUMNS: Column<NodeRow>[] = [
  {
    title: "Name",
    className: "Prometheus-table__shrink",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    title: "CPU",
    className: "Prometheus-table__shrink",
    cell: (row) => describeShare(row.cpu.used, row.cpu.total, formatCores),
    sortValue: (row) => row.cpu.ratio,
  },
  {
    title: "Memory",
    className: "Prometheus-table__shrink",
    cell: (row) => describeShare(row.memory.used, row.memory.total, formatBytes),
    sortValue: (row) => row.memory.ratio,
  },
  {
    title: "Disk",
    className: "Prometheus-table__shrink",
    cell: (row) => (
      <span title={row.disk.device}>
        {describeShare(row.disk.used, row.disk.total, formatBytes)}
      </span>
    ),
    sortValue: (row) => row.disk.ratio,
  },
  {
    title: "Disk I/O",
    className: "Prometheus-table__shrink",
    cell: (row) =>
      diskIo(row) === undefined
        ? describeValue(undefined, formatRate)
        : `r ${describeValue(row.diskRead, formatRate)} · w ${describeValue(row.diskWritten, formatRate)}`,
    sortValue: diskIo,
  },
  {
    title: "Net rx",
    className: "Prometheus-table__shrink",
    cell: (row) => describeValue(row.netRx, formatRate),
    sortValue: (row) => row.netRx,
  },
  {
    title: "Net tx",
    className: "Prometheus-table__shrink",
    cell: (row) => describeValue(row.netTx, formatRate),
    sortValue: (row) => row.netTx,
  },
  {
    title: "State",
    className: "Prometheus-table__fill",
    cell: (row) => {
      const verdict = usageVerdict(row.attention, hasUsageData(row), "node");

      return <StateCell verdict={verdict} />;
    },
    sortValue: (row) => usageVerdict(row.attention, hasUsageData(row), "node").label,
  },
];

export const UsageNodesPage = observer(() => {
  const { period, choose } = useUsagePeriod();
  const [chosen, chooseNodes] = useChosenNodes();
  const { tick, refresh } = useRefresh(period);
  const [selected, setSelected] = useState<string>();
  const { nodesStore } = Renderer.K8sApi;
  const gaveUp = useLoadedStores([nodesStore]);
  const nodes = nodesStore.items as unknown as NodeLike[];
  const probe = useNodeLabel(tick);
  const label = probe.label;
  const current = useMetrics(
    label ? nodeQueries(label, CURRENT_WINDOW) : undefined,
    period,
    "current",
    tick,
  );
  // Only to tell "no Prometheus" from "no node-exporter" when no node label answers.
  const podCpu = useMetrics(
    probe.probed && !label ? { podCpu: podQueries(CURRENT_WINDOW).podCpu } : undefined,
    period,
    "current",
    tick,
  );
  const charted = label ? nodeQueries(label, chartWindow(period)) : undefined;
  const series = useMetrics(
    charted
      ? Object.fromEntries(chartQueries(NODE_CHARTS).map((query) => [query, charted[query]]))
      : undefined,
    period,
    "chart",
    tick,
  );
  const state = probe.probed ? usageState(probe.probes, podCpu.data.podCpu) : undefined;
  const choices = nodeChoices(nodes.map((node) => node.metadata.name));
  const effective = stillOffered(choices, chosen);
  const keep = keepChosen(effective);
  const rows = nodeRows(nodes, current.data as UsageMetrics, label ?? "node").filter((each) =>
    keep(each.name),
  );
  const nodeOf = nodeKeyOf(label ?? "node", nodes);
  const loading = !probe.probed || current.loading || series.loading;
  const asking = isFirstAsk(probe.probed, [current, series, podCpu]);
  const row = rows.find((each) => each.name === selected);

  return (
    <ListPage
      title="Nodes"
      subline={
        gaveUp
          ? "Could not list the nodes, so what is below may be incomplete."
          : usageSubline(period, asking)
      }
      section="prometheus-usage-nodes"
      rows={rows}
      columns={COLUMNS}
      keyOf={(each) => each.name}
      searchTexts={(each) => [each.name, ...each.attention.map((item) => item.label)]}
      onOpen={(each) => setSelected(each.name)}
      empty={effective.length > 0 ? "None of the chosen nodes is listed." : "No node is listed."}
      namespaced={false}
      action={<RefreshButton onClick={refresh} loading={loading} period={period} />}
      filters={
        <UsageControls period={period} onChange={choose}>
          <ChoiceFilter
            id="prometheus-usage-node-filter"
            choices={choices}
            chosen={effective}
            names={NODE_CHOICES}
            onChange={chooseNodes}
            section="prometheus-usage-node-filter"
          />
        </UsageControls>
      }
      above={
        <>
          <UsageNotice state={state} clusters={probe.clusters} />
          {label && (
            <div className="Prometheus-charts" data-section="prometheus-usage-node-charts">
              {NODE_CHARTS.map((chart) => {
                const answers = chart.queries.map(
                  (query) => series.data[query as keyof typeof series.data],
                );

                return (
                  <UsageChart
                    key={chart.id}
                    title={chart.title}
                    name={`prometheus-nodes-${chart.id}`}
                    lines={groupedDatasets(answers, nodeOf, keep)}
                    unit={chart.unit}
                    range={series.range}
                    note={chartNote(answers, series.range !== undefined)}
                    section={`prometheus-usage-node-${chart.id}`}
                  />
                );
              })}
            </div>
          )}
        </>
      }
    >
      <NodeUsageDrawer
        row={row}
        series={series.data as UsageMetrics}
        range={series.range}
        nodeOf={nodeOf}
        onClose={() => setSelected(undefined)}
      />
    </ListPage>
  );
});
