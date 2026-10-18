import type { CollectorRow } from "../collectors/collectors";
import {
  type CoverageFilter,
  type CoverageRow,
  FILTER_TITLES,
  matchesFilter,
  tally,
} from "../coverage/coverage";
import { needsAttention, plural, RANK, type Tone, type Verdict } from "../shared/verdict";

/** What a page's route params name; `kind` only for a Coverage row. */
export interface RowParams {
  kind?: string;
  namespace?: string;
  name?: string;
}

export interface AttentionItem {
  key: string;
  page: "coverage" | "collectors";
  opens: RowParams;
  name: string;
  meta: string;
  verdict: Verdict;
}

/** Worst first; Opted out and Unmanaged are choices, not problems. */
export function attentionOf(coverage: CoverageRow[], collectors: CollectorRow[]): AttentionItem[] {
  return [
    ...coverage
      .filter((row) => matchesFilter(row, "attention"))
      .map((row) => ({
        key: `coverage/${row.key}`,
        page: "coverage" as const,
        opens: { kind: row.kind, namespace: row.namespace, name: row.name },
        name: row.name,
        meta: `${row.kind} · ${row.namespace}`,
        verdict: row.verdict,
      })),
    ...collectors
      .filter((row) => needsAttention(row.verdict))
      .map((row) => ({
        key: `collectors/${row.key}`,
        page: "collectors" as const,
        opens: { namespace: row.namespace, name: row.name },
        name: row.name,
        meta: `OpenTelemetryCollector · ${row.namespace}`,
        verdict: row.verdict,
      })),
  ].sort((a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone]);
}

/** The key of the row whose drawer the route params open; undefined without a name. */
export function namedKey(page: AttentionItem["page"], named: RowParams): string | undefined {
  if (!named.name) return undefined;

  const key = `${named.namespace ?? ""}/${named.name}`;

  return page === "coverage" ? `${named.kind ?? ""}/${key}` : key;
}

export function describeHeadline(coverage: CoverageRow[], collectors: CollectorRow[]): string {
  const active = coverage.filter((row) => row.state !== "opted-out").length;
  const workloadsNeedingAttention = coverage.filter((row) =>
    matchesFilter(row, "attention"),
  ).length;
  const collectorsNeedingAttention = collectors.filter((row) => needsAttention(row.verdict)).length;
  const parts = [
    ...(workloadsNeedingAttention > 0
      ? [`${workloadsNeedingAttention} of ${plural(active, "workload")}`]
      : []),
    ...(collectorsNeedingAttention > 0
      ? [`${collectorsNeedingAttention} of ${plural(collectors.length, "collector")}`]
      : []),
  ];

  if (parts.length > 0) {
    const singular =
      parts.length === 1 && workloadsNeedingAttention + collectorsNeedingAttention === 1;

    return `${parts.join(" and ")} need${singular ? "s" : ""} attention`;
  }
  if (active === 0) return "No workload opts in to auto-instrumentation";
  if (coverage.some((row) => row.state === "pending")) {
    return `Checking ${plural(active, "instrumented workload")}`;
  }

  return `${plural(active, "instrumented workload")}, all injected`;
}

export interface Card {
  label: string;
  /** Undefined while its list is not read: a zero would say all is well. */
  value?: number;
  tone?: Tone;
  title: string;
  opens: { page: "coverage"; filter: CoverageFilter } | { page: "collectors" };
}

export const COLLECTORS_CARD_TITLE =
  "Opens the collectors whose pods or target allocator are not ready";

const opensTitle = (chipTitle: string) => chipTitle.replace(/^Shows /, "Opens ");

/** A Coverage card counts the rows its filter keeps; Collectors not ready, the top of its list. */
export function cardsOf(
  coverage: CoverageRow[],
  collectors: CollectorRow[],
  collectorsRead: boolean,
): Card[] {
  const counts = tally(coverage);
  const coverageCard = (label: string, filter: CoverageFilter, tone?: Tone): Card => ({
    label,
    value: counts[filter],
    tone,
    title: opensTitle(FILTER_TITLES[filter]),
    opens: { page: "coverage", filter },
  });

  return [
    coverageCard("Restart needed", "restart-needed", "warning"),
    coverageCard("Not injected", "not-injected", "critical"),
    coverageCard("Injected", "injected"),
    coverageCard("Opted out", "opted-out", "info"),
    {
      label: "Collectors not ready",
      value: collectorsRead
        ? collectors.filter((row) => needsAttention(row.verdict)).length
        : undefined,
      tone: "critical",
      title: COLLECTORS_CARD_TITLE,
      opens: { page: "collectors" },
    },
  ];
}
