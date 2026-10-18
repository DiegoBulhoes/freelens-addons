import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import type { PodLike, PvcLike } from "../api/shared/types";
import {
  describeAgainst,
  describeShare,
  describeUsage,
  describeValue,
  formatBytes,
  formatCores,
  formatRate,
} from "../api/shared/units";
import { groupedDatasets } from "../api/usage/series";
import {
  chartNote,
  describeVolumes,
  hasUsageData,
  POD_METRIC_IDS,
  POD_METRICS,
  type PodMetric,
  type PodRow,
  podKeyOf,
  podRows,
  topPods,
  type UsageMetrics,
  usageState,
  usageVerdict,
} from "../api/usage/usage";
import {
  chosenPods,
  filterPods,
  nodeChoices,
  podChartTitle,
  podsOnNodes,
  stillOffered,
} from "../api/usage/usage-filters";
import {
  CURRENT_WINDOW,
  chartWindow,
  forPods,
  isFirstAsk,
  NODE_CHOICES,
  namespaceMatcher,
  podQueries,
  usageSubline,
} from "../api/usage/usage-queries";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { UsageChart } from "../components/usage-chart";
import { useLoadedStores } from "../hooks/load-stores";
import { useMetrics, useNodeLabel } from "../hooks/use-metrics";
import { useNamespaceScope } from "../hooks/use-namespace-scope";
import {
  ChoiceFilter,
  RefreshButton,
  UsageControls,
  UsageNotice,
  useChosenNodes,
  useRefresh,
  useUsagePeriod,
} from "../usage/controls";
import { PodUsageDrawer } from "../usage/pod-usage-drawer";

const TOP = 10;
// Search and sort run over every pod; only the DOM is capped.
const DRAWN = 200;

const network = (row: PodRow, value: number | undefined) =>
  row.hostNetwork ? (
    <span className="Prometheus-muted" title="Its counters are the node's, so they are not shown">
      host network
    </span>
  ) : (
    describeValue(value, formatRate)
  );

// Name and namespace are cut, and CPU, memory and volumes kept short, so the table fits the page.
const cut = (text: string, width: "name" | "namespace") => (
  <span className={`Prometheus-usage__cut Prometheus-usage__cut--${width}`} title={text}>
    {text}
  </span>
);

const COLUMNS: Column<PodRow>[] = [
  {
    title: "Name",
    className: "Prometheus-table__shrink",
    cell: (row) => cut(row.name, "name"),
    sortValue: (row) => row.name,
  },
  {
    title: "Namespace",
    className: "Prometheus-table__shrink",
    cell: (row) => cut(row.namespace, "namespace"),
    sortValue: (row) => row.namespace,
  },
  {
    title: "CPU",
    className: "Prometheus-table__shrink",
    cell: (row) => (
      <span title={describeUsage(row.cpu.used, row.cpu.request, row.cpu.limit, formatCores)}>
        {describeAgainst(row.cpu.used, row.cpu.request, row.cpu.limit, formatCores)}
      </span>
    ),
    sortValue: (row) => row.cpu.used,
  },
  {
    title: "Memory",
    className: "Prometheus-table__shrink",
    cell: (row) => (
      <span
        title={describeUsage(row.memory.used, row.memory.request, row.memory.limit, formatBytes)}
      >
        {describeAgainst(row.memory.used, row.memory.request, row.memory.limit, formatBytes)}
      </span>
    ),
    sortValue: (row) => row.memory.used,
  },
  {
    title: "Net rx",
    className: "Prometheus-table__shrink",
    cell: (row) => network(row, row.netRx),
    sortValue: (row) => row.netRx,
  },
  {
    title: "Net tx",
    className: "Prometheus-table__shrink",
    cell: (row) => network(row, row.netTx),
    sortValue: (row) => row.netTx,
  },
  {
    title: "Disk I/O",
    className: "Prometheus-table__shrink",
    cell: (row) => describeValue(row.diskIo, formatRate),
    sortValue: (row) => row.diskIo,
  },
  {
    title: "Volumes",
    className: "Prometheus-table__shrink",
    cell: (row) => (
      <span
        title={row.pvcs
          .map((pvc) => `${pvc.name}: ${describeShare(pvc.used, pvc.total, formatBytes)}`)
          .join("\n")}
      >
        {describeVolumes(row.pvcs)}
      </span>
    ),
    sortValue: (row) => Math.max(-1, ...row.pvcs.map((pvc) => pvc.ratio ?? -1)),
  },
  {
    title: "State",
    className: "Prometheus-table__fill",
    cell: (row) => {
      const verdict = usageVerdict(row.attention, hasUsageData(row), "pod");

      return <StateCell verdict={verdict} />;
    },
    sortValue: (row) => usageVerdict(row.attention, hasUsageData(row), "pod").label,
  },
];

const METRIC_LABELS = Object.fromEntries(
  POD_METRIC_IDS.map((id) => [id, POD_METRICS[id].label]),
) as Record<PodMetric, string>;
const METRIC_TITLES = Object.fromEntries(
  POD_METRIC_IDS.map((id) => [
    id,
    `Charts the ${TOP} pods using the most ${POD_METRICS[id].label}`,
  ]),
) as Record<PodMetric, string>;

export const UsagePodsPage = observer(() => {
  const { period, choose } = useUsagePeriod();
  const [nodes, chooseNodes] = useChosenNodes();
  const [pods, choosePods] = useState<string[]>([]);
  const { tick, refresh } = useRefresh(period);
  const [metric, setMetric] = useState<PodMetric>("cpu");
  const [selected, setSelected] = useState<string>();
  const scope = useNamespaceScope();
  const { podsStore, pvcStore, namespaceStore } = Renderer.K8sApi;
  const gaveUp = useLoadedStores([podsStore, pvcStore], scopeKey(scope));
  const inScope = withinScope(podsStore.items as unknown as PodLike[], scope);
  const pvcs = withinScope(pvcStore.items as unknown as PvcLike[], scope);
  const probe = useNodeLabel(tick);
  const matcher = namespaceMatcher(
    scope,
    namespaceStore.items.map((each) => each.getName()),
  );
  const current = useMetrics(podQueries(CURRENT_WINDOW, matcher), period, "current", tick);
  const all = podRows(inScope, current.data as UsageMetrics, pvcs);
  const nodeNames = nodeChoices(all.map((each) => each.node));
  const onNodes = stillOffered(nodeNames, nodes);
  const offered = podsOnNodes(all, onNodes);
  const picked = chosenPods(offered, pods);
  const rows = filterPods(all, onNodes, picked);
  const top = topPods(rows, metric, TOP);
  const series = useMetrics(
    top.length > 0
      ? { chart: forPods(podQueries(chartWindow(period))[POD_METRICS[metric].query], top) }
      : undefined,
    period,
    "chart",
    // After each current answer, which picks the top ten, so the chart is asked once per refresh.
    current.answers,
  );
  const state = probe.probed ? usageState(probe.probes, current.data.podCpu) : undefined;
  const loading = !probe.probed || current.loading || series.loading;
  const asking = isFirstAsk(probe.probed, [current, series]);
  const shown = new Set(top.map((row) => row.key));
  const row = rows.find((each) => each.key === selected);

  return (
    <ListPage
      title="Pods"
      subline={
        gaveUp
          ? "Could not list the pods, so what is below may be incomplete."
          : usageSubline(period, asking)
      }
      section="prometheus-usage-pods"
      rows={rows}
      columns={COLUMNS}
      limit={DRAWN}
      keyOf={(each) => each.key}
      searchTexts={(each) => [
        each.name,
        each.namespace,
        each.node ?? "",
        ...each.attention.map((item) => item.label),
      ]}
      onOpen={(each) => setSelected(each.key)}
      empty={
        onNodes.length > 0
          ? "No pod in the namespaces in scope runs on the chosen nodes."
          : "No pod in the namespaces in scope."
      }
      action={<RefreshButton onClick={refresh} loading={loading} period={period} />}
      filters={
        <UsageControls period={period} onChange={choose}>
          <ChoiceFilter
            id="prometheus-usage-pod-node-filter"
            choices={nodeNames}
            chosen={onNodes}
            names={NODE_CHOICES}
            onChange={chooseNodes}
            section="prometheus-usage-node-filter"
          />
          <ChoiceFilter
            id="prometheus-usage-pod-filter"
            choices={offered.map((each) => each.key)}
            chosen={picked}
            names={{ all: "All pods", one: "Pod", many: "Pods" }}
            onChange={choosePods}
            section="prometheus-usage-pod-filter"
          />
        </UsageControls>
      }
      above={
        <>
          <UsageNotice
            state={state === "no-node-metrics" ? undefined : state}
            clusters={probe.clusters}
          />
          {state !== "not-configured" && (
            <div className="Prometheus-charts" data-section="prometheus-usage-pod-charts">
              <section className="Prometheus-section">
                <FilterChips
                  filters={POD_METRIC_IDS}
                  labels={METRIC_LABELS}
                  titles={METRIC_TITLES}
                  current={metric}
                  onChange={(id) => id && setMetric(id)}
                  all={false}
                  section="prometheus-usage-pod-metric"
                />
                <UsageChart
                  title={podChartTitle(POD_METRICS[metric].label, picked.length, TOP)}
                  name={`prometheus-pods-${metric}`}
                  lines={groupedDatasets([series.data.chart], podKeyOf, (key) => shown.has(key))}
                  unit={POD_METRICS[metric].unit}
                  range={series.range}
                  note={
                    // With no pod to rank, the current answer says why.
                    top.length === 0
                      ? chartNote(
                          [current.data[POD_METRICS[metric].query]],
                          current.range !== undefined,
                        )
                      : chartNote([series.data.chart], series.range !== undefined)
                  }
                  section="prometheus-usage-pod-chart"
                />
              </section>
            </div>
          )}
        </>
      }
    >
      <PodUsageDrawer
        row={row}
        period={period}
        tick={tick}
        onClose={() => setSelected(undefined)}
      />
    </ListPage>
  );
});
