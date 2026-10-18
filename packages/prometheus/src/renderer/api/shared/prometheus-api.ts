import type { LiveRule, RuleGroup, Target } from "./types";

export class PrometheusApiError extends Error {
  constructor(
    readonly errorType: string,
    message: string,
  ) {
    super(message);
    this.name = "PrometheusApiError";
  }
}

interface Envelope {
  status?: string;
  errorType?: string;
  error?: string;
  data?: Record<string, unknown>;
}

function dataOf(json: unknown): Record<string, unknown> {
  const envelope = (json ?? {}) as Envelope;

  if (envelope.status !== "success" || !envelope.data) {
    throw new PrometheusApiError(
      envelope.errorType ?? "bad_response",
      envelope.error ?? "Prometheus did not answer with a success status",
    );
  }

  return envelope.data;
}

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// A scrape URL carries an endpoint's params as its query; the spec's params are not shown either.
export function withoutQuery(text: string): string {
  return text.replace(/(https?:\/\/[^\s?"#]*)[?#][^\s"]*/g, "$1");
}

export function parseTargets(json: unknown): Target[] {
  return list<Record<string, unknown>>(dataOf(json).activeTargets).map((raw) => ({
    scrapePool: String(raw.scrapePool ?? ""),
    labels: (raw.labels ?? {}) as Record<string, string>,
    scrapeUrl: withoutQuery(String(raw.scrapeUrl ?? "")),
    health: raw.health === "up" || raw.health === "down" ? raw.health : "unknown",
    lastError: withoutQuery(String(raw.lastError ?? "")),
    lastScrape: raw.lastScrape as string | undefined,
    scrapeInterval: raw.scrapeInterval as string | undefined,
  }));
}

export function parsePools(json: unknown): string[] {
  return list<string>(dataOf(json).scrapePools);
}

export function parseRules(json: unknown): RuleGroup[] {
  return list<Record<string, unknown>>(dataOf(json).groups).map((group) => ({
    name: String(group.name ?? ""),
    file: String(group.file ?? ""),
    rules: list<LiveRule>(group.rules),
  }));
}

/** A TargetAllocator's /jobs: an object keyed by job name, the operator's pool names. */
export function parseAllocatorJobs(json: unknown): string[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new PrometheusApiError(
      "bad_response",
      "The TargetAllocator did not answer with its jobs",
    );
  }

  return Object.keys(json);
}

/** The Alertmanagers it sends to; the dropped ones receive nothing. */
export function parseAlertmanagers(json: unknown): string[] {
  return list<Record<string, unknown>>(dataOf(json).activeAlertmanagers).map((each) =>
    withoutQuery(String(each.url ?? "")),
  );
}
