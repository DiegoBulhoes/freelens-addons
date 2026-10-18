import { formatBytes, formatCores, formatRate, NO_DATA } from "../shared/units";
import type { Unit } from "./usage";

export const FORMATS: Record<Unit, (value: number) => string> = {
  cores: formatCores,
  bytes: formatBytes,
  rate: formatRate,
};

export interface TooltipItem {
  datasetIndex?: number;
  index?: number;
}

export interface TooltipData {
  datasets?: { label?: string; data?: { y?: number | null }[] }[];
}

const pointAt = ({ datasetIndex = 0, index = 0 }: TooltipItem, { datasets = [] }: TooltipData) =>
  datasets[datasetIndex]?.data?.[index]?.y;

/** The most rows a tooltip lists, so it fits inside the chart, which clips it. */
export const TOOLTIP_ROWS = 10;

/** How many lines are higher than this one at its time; a gap ranks last. */
function rankOf(item: TooltipItem, data: TooltipData): number {
  const value = pointAt(item, data);

  if (value == null) return Number.POSITIVE_INFINITY;

  return (data.datasets ?? []).filter((_, datasetIndex) => {
    const other = pointAt({ datasetIndex, index: item.index }, data);

    return (
      other != null &&
      (other > value || (other === value && datasetIndex < (item.datasetIndex ?? 0)))
    );
  }).length;
}

// The host's tooltip waits for the pointer on a point, which a line drawn without points rarely gets.
export function tooltipOptions(unit: Unit) {
  return {
    hover: { mode: "index", intersect: false },
    tooltips: {
      mode: "index",
      intersect: false,
      titleFontSize: 11,
      bodyFontSize: 11,
      bodySpacing: 1,
      yPadding: 4,
      titleMarginBottom: 4,
      filter: (item: TooltipItem, data: TooltipData) => rankOf(item, data) < TOOLTIP_ROWS,
      itemSort: (a: TooltipItem, b: TooltipItem, data: TooltipData) =>
        (pointAt(b, data) ?? 0) - (pointAt(a, data) ?? 0),
      callbacks: {
        label: (item: TooltipItem, data: TooltipData) => {
          const value = pointAt(item, data);
          const label = data.datasets?.[item.datasetIndex ?? 0]?.label ?? "";

          return `${label}: ${value == null ? NO_DATA : FORMATS[unit](value)}`;
        },
      },
    },
  };
}
