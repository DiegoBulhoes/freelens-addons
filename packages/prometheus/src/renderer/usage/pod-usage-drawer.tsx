import { observer } from "mobx-react";
import {
  describeShare,
  describeUsage,
  describeValue,
  formatBytes,
  formatCores,
  formatRate,
} from "../api/shared/units";
import { groupedDatasets } from "../api/usage/series";
import { chartNote, hasUsageData, type PodRow, podKeyOf, usageVerdict } from "../api/usage/usage";
import { chartWindow, forPods, type Period, podQueries } from "../api/usage/usage-queries";
import { followLink } from "../components/drawer-link";
import { AttentionFacts, FactLink } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";
import { REQUEST_COLOUR, UsageChart, withLevel } from "../components/usage-chart";
import { useMetrics } from "../hooks/use-metrics";

/** This pod's own series over the window, asked only while the drawer is open. */
function usePodSeries(row: PodRow | undefined, period: Period, tick: number) {
  const queries = podQueries(chartWindow(period));
  const pod = row ? [{ namespace: row.namespace, name: row.name }] : [];

  return useMetrics(
    row
      ? {
          cpu: forPods(queries.podCpu, pod),
          memory: forPods(queries.podMemory, pod),
          rx: forPods(queries.podNetRx, pod),
          tx: forPods(queries.podNetTx, pod),
          disk: forPods(queries.podDiskIo, pod),
        }
      : undefined,
    period,
    "chart",
    tick,
  );
}

export const PodUsageDrawer = observer(
  ({
    row,
    period,
    tick,
    onClose,
  }: {
    row?: PodRow;
    period: Period;
    tick: number;
    onClose: () => void;
  }) => {
    const series = usePodSeries(row, period, tick);
    const verdict = row && usageVerdict(row.attention, hasUsageData(row), "pod");
    const lines = (key: keyof typeof series.data, label: string) =>
      groupedDatasets([series.data[key]], podKeyOf).map((line) => ({ ...line, id: key, label }));
    const note = (...keys: (keyof typeof series.data)[]) =>
      chartNote(
        keys.map((key) => series.data[key]),
        series.range !== undefined,
      );

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind="Pod"
        name={row?.name ?? ""}
        onClose={onClose}
        state={verdict}
        section="prometheus-usage-pod"
      >
        {row && (
          <>
            <dl className="Prometheus-facts">
              <dt>Namespace</dt>
              <dd>{row.namespace}</dd>
              <dt>Node</dt>
              <dd>
                {row.node ? (
                  <FactLink
                    to={{ host: "Node", name: row.node }}
                    onFollow={(to) => followLink(to, onClose)}
                  >
                    {row.node}
                  </FactLink>
                ) : (
                  "—"
                )}
              </dd>
              <dt>CPU</dt>
              <dd>{describeUsage(row.cpu.used, row.cpu.request, row.cpu.limit, formatCores)}</dd>
              <dt>Memory</dt>
              <dd>
                {describeUsage(row.memory.used, row.memory.request, row.memory.limit, formatBytes)}
              </dd>
              <dt>Network</dt>
              <dd>
                {row.hostNetwork
                  ? "Host network: its counters are the node's, so they are not shown"
                  : `rx ${describeValue(row.netRx, formatRate)} · tx ${describeValue(row.netTx, formatRate)}`}
              </dd>
              <dt>Disk I/O</dt>
              <dd>{describeValue(row.diskIo, formatRate)}</dd>
              {row.pvcs.map((pvc) => (
                <div key={pvc.name} style={{ display: "contents" }}>
                  <dt>Volume {pvc.name}</dt>
                  <dd>{describeShare(pvc.used, pvc.total, formatBytes)}</dd>
                </div>
              ))}
              <AttentionFacts attention={row.attention} />
              <dt>Host list</dt>
              <dd>
                <FactLink
                  to={{ host: "Pod", name: row.name }}
                  onFollow={(to) => followLink(to, onClose)}
                >
                  {`${row.name} in the Pods list`}
                </FactLink>
              </dd>
            </dl>

            <UsageChart
              title="CPU"
              name={`prometheus-pod-${row.key}-cpu`}
              lines={withLevel(
                lines("cpu", "Used"),
                [
                  {
                    id: "request",
                    label: "Request",
                    value: row.cpu.request,
                    colour: REQUEST_COLOUR,
                  },
                  { id: "limit", label: "Limit", value: row.cpu.limit },
                ],
                series.range,
              )}
              unit="cores"
              range={series.range}
              note={note("cpu")}
              section="prometheus-usage-pod-cpu"
            />
            <UsageChart
              title="Memory"
              name={`prometheus-pod-${row.key}-memory`}
              lines={withLevel(
                lines("memory", "Working set"),
                [
                  {
                    id: "request",
                    label: "Request",
                    value: row.memory.request,
                    colour: REQUEST_COLOUR,
                  },
                  { id: "limit", label: "Limit", value: row.memory.limit },
                ],
                series.range,
              )}
              unit="bytes"
              range={series.range}
              note={note("memory")}
              section="prometheus-usage-pod-memory"
            />
            {!row.hostNetwork && (
              <UsageChart
                title="Network"
                name={`prometheus-pod-${row.key}-network`}
                lines={[...lines("rx", "Receive"), ...lines("tx", "Transmit")]}
                unit="rate"
                range={series.range}
                note={note("rx", "tx")}
                section="prometheus-usage-pod-network"
              />
            )}
            <UsageChart
              title="Disk I/O"
              name={`prometheus-pod-${row.key}-disk`}
              lines={lines("disk", "Read + write")}
              unit="rate"
              range={series.range}
              note={note("disk")}
              section="prometheus-usage-pod-disk"
            />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
