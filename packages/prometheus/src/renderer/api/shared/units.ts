export const NO_DATA = "no data";

const BINARY = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

/** Binary units, as the host's charts label bytes. */
export function formatBytes(bytes: number): string {
  let value = Math.abs(bytes);
  let unit = 0;

  while (value >= 1024 && unit < BINARY.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const shown = unit === 0 || value >= 100 ? Math.round(value) : Number(value.toFixed(1));

  return `${bytes < 0 ? "-" : ""}${shown} ${BINARY[unit]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Millicores below one core, as Kubernetes writes requests. */
export function formatCores(cores: number): string {
  if (cores < 1) return `${Math.round(cores * 1000)}m`;

  return String(Number(cores.toFixed(2)));
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** "used of total · %", or no data when the usage is missing; never 0 for a missing value. */
export function describeShare(
  used: number | undefined,
  total: number | undefined,
  format: (value: number) => string,
): string {
  if (used === undefined) return NO_DATA;
  if (!total) return format(used);

  return `${format(used)} of ${format(total)} · ${formatPercent(used / total)}`;
}

export function describeUsage(
  used: number | undefined,
  request: number | undefined,
  limit: number | undefined,
  format: (value: number) => string,
): string {
  return [
    used === undefined ? NO_DATA : format(used),
    ...(request === undefined ? [] : [`req ${format(request)}`]),
    ...(limit === undefined ? [] : [`lim ${format(limit)}`]),
  ].join(" · ");
}

/** The use and its share of the limit, or of the request without one, short enough for a table cell. */
export function describeAgainst(
  used: number | undefined,
  request: number | undefined,
  limit: number | undefined,
  format: (value: number) => string,
): string {
  if (used === undefined) return NO_DATA;
  if (limit) return `${format(used)} · ${formatPercent(used / limit)} lim`;
  if (request) return `${format(used)} · ${formatPercent(used / request)} req`;

  return format(used);
}

export function describeValue(
  value: number | undefined,
  format: (value: number) => string,
): string {
  return value === undefined ? NO_DATA : format(value);
}

const CPU_UNITS = { n: 1e-9, u: 1e-6, m: 1e-3 } as const;

export function cpuCores(quantity: string | undefined): number | undefined {
  const match = /^([0-9.]+(?:e[-+]?[0-9]+)?)(n|u|m)?$/.exec(quantity?.trim() ?? "");

  if (!match) return undefined;

  const unit = match[2] as keyof typeof CPU_UNITS | undefined;

  return Number(match[1]) * (unit ? CPU_UNITS[unit] : 1);
}

const BYTE_UNITS: Record<string, number> = {
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

export function quantityBytes(quantity: string | undefined): number | undefined {
  const match = /^([0-9.]+(?:e[-+]?[0-9]+)?)([kMGTPE]i?|Ki)?$/.exec(quantity?.trim() ?? "");

  if (!match) return undefined;

  const unit = BYTE_UNITS[match[2] ?? ""];

  return unit === undefined ? undefined : Number(match[1]) * unit;
}
