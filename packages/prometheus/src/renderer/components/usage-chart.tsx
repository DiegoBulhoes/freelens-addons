import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { QueryRange } from "../api/shared/types";
import { formatRate } from "../api/shared/units";
import { tooltipOptions } from "../api/usage/chart-options";
import { type Dataset, levelDataset, onGrid } from "../api/usage/series";
import type { Unit } from "../api/usage/usage";

const {
  Component: { BarChart, cpuOptions, memoryOptions },
  Theme,
} = Renderer;

// The host's own pod and node chart colours; two theme colours make ten for a top ten.
const LINE_COLOURS = [
  "#00a7a0",
  "#c93dce",
  "#64c5d6",
  "#46cd9e",
  "#ffc63d",
  "#ff963d",
  "#30b24d",
  "#9cd3ce",
];

// The host's axis presets; its tooltip presets are replaced, as its CPU one formats bytes.
const OPTIONS: Record<Unit, unknown> = {
  cores: { scales: cpuOptions.scales, ...tooltipOptions("cores") },
  bytes: { scales: memoryOptions.scales, ...tooltipOptions("bytes") },
  rate: {
    scales: {
      yAxes: [{ ticks: { callback: (value: number | string) => formatRate(Number(value)) } }],
    },
    ...tooltipOptions("rate"),
  },
};

const LINE = { type: "line", fill: false, borderWidth: 2, pointRadius: 0, lineTension: 0 };

export interface ChartLine extends Dataset {
  /** A request, limit or capacity: dashed, in the host's capacity colour unless `colour` says. */
  level?: boolean;
  colour?: string;
}

// The host's own colour for requests on its node charts.
export const REQUEST_COLOUR = "#30b24d";

/** Usage lines with a request, limit or capacity beside them; a level alone would hide "no metrics". */
export function withLevel(
  used: ChartLine[],
  levels: { id: string; label: string; value: number | undefined; colour?: string }[],
  range: QueryRange | undefined,
): ChartLine[] {
  if (used.length === 0 || !range) return used;

  return [
    ...used,
    ...levels.flatMap(({ id, label, value, colour }) =>
      levelDataset(id, label, value, range).map((line) => ({ ...line, level: true, colour })),
    ),
  ];
}

// One series draws as bars; several, or one with a level, as lines, which the host chart takes per dataset.
export const UsageChart = observer(
  ({
    title,
    name,
    lines,
    unit,
    range,
    note,
    section,
  }: {
    title: string;
    name: string;
    lines: ChartLine[];
    unit: Unit;
    range?: QueryRange;
    /** Shown in place of the canvas when no line is drawn; see chartNote. */
    note: string;
    section: string;
  }) => {
    const { blue, magenta, chartCapacityColor } = Theme.activeTheme.get().colors;
    const palette = [...LINE_COLOURS, blue, magenta];
    const asLines = lines.length > 1;
    let next = 0;
    const datasets = (range ? onGrid(lines, range) : lines).map(({ level, colour, ...line }) => ({
      ...line,
      borderColor: colour ?? (level ? chartCapacityColor : palette[next++ % palette.length]),
      ...(asLines ? LINE : {}),
      ...(level ? { borderDash: [4, 4] } : {}),
    }));

    return (
      <section className="Prometheus-section Prometheus-chart" data-section={section}>
        <h3 className="Prometheus-section__title">{title}</h3>
        {lines.length === 0 ? (
          <p className="Prometheus-section__note Prometheus-chart__empty">{note}</p>
        ) : (
          <div className="Prometheus-chart__canvas">
            <BarChart
              // The host's update keeps a line that left and drops one that came, so a new set remounts.
              key={datasets.map((dataset) => dataset.id).join("|")}
              name={name}
              data={{ datasets }}
              options={OPTIONS[unit] as typeof cpuOptions}
              minTime={range?.start}
              maxTime={range?.end}
            />
          </div>
        )}
      </section>
    );
  },
);
