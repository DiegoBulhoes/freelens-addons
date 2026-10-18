export const TTL_ANNOTATION = "trivy-operator.aquasecurity.github.io/report-ttl";

// The operator's default scannerReportTTL, for a report that carries no usable one.
export const DEFAULT_RESCAN_MS = 24 * 60 * 60 * 1000;

export interface Annotated {
  metadata?: { annotations?: Partial<Record<string, string>> };
}

const UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  μs: 1e-3,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

const PART = /(\d+\.?\d*|\.\d+)(ns|us|µs|μs|ms|s|m|h)/y;

/** Go's time.Duration text ("24h0m0s", "1.5h", "0s"); undefined for anything else or a negative. */
export function parseGoDuration(text: string): number | undefined {
  if (text === "0") return 0;
  if (text === "") return undefined;

  PART.lastIndex = 0;
  let total = 0;

  while (PART.lastIndex < text.length) {
    const match = PART.exec(text);

    if (!match) return undefined;

    total += Number(match[1]) * (UNIT_MS[match[2] as string] as number);
  }

  return total;
}

// "0s" or an unreadable value gives no interval to judge by, so the operator's default stands in.
export function rescanIntervalOf(report: Annotated): number {
  const raw = report.metadata?.annotations?.[TTL_ANNOTATION];
  const parsed = raw === undefined ? undefined : parseGoDuration(raw.trim());

  return parsed !== undefined && parsed > 0 ? parsed : DEFAULT_RESCAN_MS;
}
