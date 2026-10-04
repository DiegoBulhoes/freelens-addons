export type LogLevel = "error" | "warning" | "info";

export interface LogEntry {
  at: string;
  pod: string;
  level: LogLevel;
  logger?: string;
  message: string;
  /** Its line in the pod's log: lines can repeat to the nanosecond. */
  line: number;
  /** How many times this pod said the same thing; the newest is kept. */
  times: number;
}

// Postgres severities arrive inside the record; the instance manager's own lines carry `level`.
function levelOf(severity: string | undefined): LogLevel {
  const value = (severity ?? "").toUpperCase();

  if (["ERROR", "FATAL", "PANIC"].includes(value)) return "error";
  if (value === "WARNING" || value === "WARN") return "warning";

  return "info";
}

interface RawLine {
  ts?: string;
  level?: string;
  logger?: string;
  msg?: string;
  logging_pod?: string;
  record?: { error_severity?: string; message?: string };
  error?: string;
}

export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const [index, line] of text.split("\n").entries()) {
    let raw: RawLine;

    try {
      raw = JSON.parse(line) as RawLine;
    } catch {
      continue;
    }

    if (!raw.ts || !raw.logging_pod) continue;

    const record = raw.record;
    const message =
      record?.message ??
      [raw.msg, raw.error].filter((part) => part && part !== "record").join(": ");

    if (!message) continue;

    entries.push({
      at: raw.ts,
      pod: raw.logging_pod,
      level: levelOf(record?.error_severity ?? raw.level),
      logger: raw.logger,
      message,
      line: index,
      times: 1,
    });
  }

  return entries;
}

/** Every instance's lines in one stream, newest first, at or above the level asked for, repeats folded. */
export function mergeLogs(texts: string[], least: LogLevel, limit: number): LogEntry[] {
  const rank: Record<LogLevel, number> = { error: 0, warning: 1, info: 2 };
  const kept = new Map<string, LogEntry>();

  for (const entry of texts
    .flatMap(parseLog)
    .filter((each) => rank[each.level] <= rank[least])
    .sort((a, b) => b.at.localeCompare(a.at))) {
    const key = `${entry.pod}\u0000${entry.logger}\u0000${entry.message}`;
    const newest = kept.get(key);

    if (newest) newest.times += 1;
    else kept.set(key, { ...entry });
  }

  return [...kept.values()].slice(0, limit);
}
