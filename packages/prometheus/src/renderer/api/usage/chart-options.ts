import { formatBytes, formatCores, formatRate, NO_DATA } from "../shared/units";
import type { Unit } from "./usage";

export const FORMATS: Record<Unit, (value: number) => string> = {
  cores: formatCores,
  bytes: formatBytes,
  rate: formatRate,
};

interface TooltipDataset {
  label?: string;
  data?: { y?: number | null }[];
}

/** The part of Chart.js 4's TooltipItem these callbacks read. */
export interface TooltipItem {
  datasetIndex: number;
  dataIndex: number;
  dataset: TooltipDataset;
}

export interface TooltipData {
  datasets?: TooltipDataset[];
}

type Point = { datasetIndex: number; dataIndex: number };

const pointAt = ({ datasetIndex, dataIndex }: Point, { datasets = [] }: TooltipData) =>
  datasets[datasetIndex]?.data?.[dataIndex]?.y;

/** The most rows a tooltip lists, so it fits inside the chart, which clips it. */
export const TOOLTIP_ROWS = 10;

/** How many lines are higher than this one at its time; a gap ranks last. */
function rankOf(item: Point, data: TooltipData): number {
  const value = pointAt(item, data);

  if (value == null) return Number.POSITIVE_INFINITY;

  return (data.datasets ?? []).filter((_, datasetIndex) => {
    const other = pointAt({ datasetIndex, dataIndex: item.dataIndex }, data);

    return (
      other != null && (other > value || (other === value && datasetIndex < item.datasetIndex))
    );
  }).length;
}

// The host's tooltip waits for the pointer on a point, which a line drawn without points rarely gets.
export function tooltipOptions(unit: Unit) {
  return {
    interaction: { mode: "index", intersect: false },
    plugins: {
      tooltip: {
        mode: "index",
        intersect: false,
        titleFont: { size: 11 },
        bodyFont: { size: 11 },
        bodySpacing: 1,
        padding: { top: 4, right: 6, bottom: 4, left: 6 },
        titleMarginBottom: 4,
        filter: (item: TooltipItem, _index: number, _items: unknown, data: TooltipData) =>
          rankOf(item, data) < TOOLTIP_ROWS,
        itemSort: (a: TooltipItem, b: TooltipItem, data: TooltipData) =>
          (pointAt(b, data) ?? 0) - (pointAt(a, data) ?? 0),
        callbacks: {
          label: (item: TooltipItem) => {
            const value = item.dataset.data?.[item.dataIndex]?.y;

            return `${item.dataset.label ?? ""}: ${value == null ? NO_DATA : FORMATS[unit](value)}`;
          },
        },
      },
    },
  };
}
