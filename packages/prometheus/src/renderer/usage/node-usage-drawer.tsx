import { observer } from "mobx-react";
import type { QueryRange } from "../api/shared/types";
import {
  describeShare,
  describeValue,
  formatBytes,
  formatCores,
  formatRate,
} from "../api/shared/units";
import { groupedDatasets, type Metric } from "../api/usage/series";
import {
  chartNote,
  hasUsageData,
  NODE_CHARTS,
  type NodeRow,
  type UsageMetrics,
  usageVerdict,
} from "../api/usage/usage";
import { followLink } from "../components/drawer-link";
import { AttentionFacts, FactLink } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";
import { UsageChart, withLevel } from "../components/usage-chart";

const LEVELS: Record<string, (row: NodeRow) => number | undefined> = {
  cpu: (row) => row.cpu.total,
  memory: (row) => row.memory.total,
};

export const NodeUsageDrawer = observer(
  ({
    row,
    series,
    range,
    nodeOf,
    onClose,
  }: {
    row?: NodeRow;
    series: UsageMetrics;
    range?: QueryRange;
    nodeOf: (metric: Metric) => string | undefined;
    onClose: () => void;
  }) => {
    const verdict = row && usageVerdict(row.attention, hasUsageData(row), "node");

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind="Node"
        name={row?.name ?? ""}
        onClose={onClose}
        state={verdict}
        section="prometheus-usage-node"
      >
        {row && (
          <>
            <dl className="Prometheus-facts">
              <dt>CPU</dt>
              <dd>{describeShare(row.cpu.used, row.cpu.total, formatCores)}</dd>
              <dt>Memory</dt>
              <dd>{describeShare(row.memory.used, row.memory.total, formatBytes)}</dd>
              <dt>Fullest disk</dt>
              <dd>
                {describeShare(row.disk.used, row.disk.total, formatBytes)}
                {row.disk.device && <span className="Prometheus-muted"> · {row.disk.device}</span>}
              </dd>
              <dt>Disk read</dt>
              <dd>{describeValue(row.diskRead, formatRate)}</dd>
              <dt>Disk written</dt>
              <dd>{describeValue(row.diskWritten, formatRate)}</dd>
              <dt>Network</dt>
              <dd>
                rx {describeValue(row.netRx, formatRate)} · tx{" "}
                {describeValue(row.netTx, formatRate)}
              </dd>
              <dt>Kubelet pressure</dt>
              <dd>{row.pressure.join(", ") || "None"}</dd>
              <AttentionFacts attention={row.attention} />
              <dt>Host list</dt>
              <dd>
                <FactLink
                  to={{ host: "Node", name: row.name }}
                  onFollow={(to) => followLink(to, onClose)}
                >
                  {`${row.name} in the Nodes list`}
                </FactLink>
              </dd>
            </dl>

            {NODE_CHARTS.map((chart) => {
              const answers = chart.queries.map((query) => series[query]);
              const used = groupedDatasets(answers, nodeOf, (node) => node === row.name).map(
                (line) => ({ ...line, label: "Used" }),
              );

              return (
                <UsageChart
                  key={chart.id}
                  title={chart.title}
                  name={`prometheus-node-${row.name}-${chart.id}`}
                  lines={withLevel(
                    used,
                    [
                      {
                        id: `${chart.id}-capacity`,
                        label: "Capacity",
                        value: LEVELS[chart.id]?.(row),
                      },
                    ],
                    range,
                  )}
                  unit={chart.unit}
                  range={range}
                  note={chartNote(answers, range !== undefined)}
                  section={`prometheus-usage-node-drawer-${chart.id}`}
                />
              );
            })}
          </>
        )}
      </ObjectDrawer>
    );
  },
);
