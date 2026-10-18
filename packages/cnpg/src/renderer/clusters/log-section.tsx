import { useEffect, useState } from "react";
import { type LogEntry, type LogLevel, type LogsRead, mergeLogs } from "../api/shared/logs";
import { keyOf } from "../api/shared/navigation";
import type { ClusterLike } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { readInstanceLogs } from "../api/writes/actions";
import { ChoiceButtons } from "./choice-buttons";

const LEVELS: { value: LogLevel; label: string; title: string }[] = [
  { value: "error", label: "Errors", title: "Shows errors from every instance" },
  { value: "warning", label: "Warnings", title: "Shows warnings from every instance" },
  { value: "info", label: "All", title: "Shows all from every instance" },
];
const SHOWN = 40;

/** Every instance's postgres log in one stream, as `kubectl cnpg logs cluster` gives it. */
export function LogSection({ cluster }: { cluster: ClusterLike }) {
  const [level, setLevel] = useState<LogLevel>("warning");
  const [read, setRead] = useState<LogsRead>();
  const key = keyOf(cluster);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the cluster, a fresh object every render.
  useEffect(() => {
    let cancelled = false;

    setRead(undefined);
    void readInstanceLogs(cluster, 300).then((logs) => {
      if (!cancelled) setRead(logs);
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const entries: LogEntry[] = read ? mergeLogs(read.texts, level, SHOWN) : [];
  const now = Date.now();

  return (
    <section className="CNPG-section" data-section="cnpg-log">
      <div className="CNPG-section__bar">
        <h3 className="CNPG-section__title">Recent log</h3>
        <ChoiceButtons options={LEVELS} value={level} onPick={setLevel} />
      </div>
      {read?.unread.map((line) => (
        <p key={line} className="CNPG-section__note CNPG-text--critical">
          {line}
        </p>
      ))}
      {!read ? (
        <p className="CNPG-section__note">Reading the instances' logs…</p>
      ) : read.texts.length === 0 ? null : entries.length === 0 ? (
        <p className="CNPG-section__note">
          Nothing at this level in the last lines of any instance.
        </p>
      ) : (
        <div className="CNPG-list">
          {entries.map((entry) => (
            <div
              key={`${entry.pod}/${entry.line}`}
              className={`CNPG-row${entry.level === "error" ? " CNPG-row--critical" : entry.level === "warning" ? " CNPG-row--warning" : ""}`}
            >
              <span className="CNPG-row__main">
                <span className="CNPG-row__name">
                  <b>{entry.pod}</b>
                  <span className="CNPG-row__meta">
                    {entry.logger}
                    {entry.times > 1 && ` · ${entry.times} times`}
                  </span>
                </span>
                <span className="CNPG-row__reason CNPG-mono">{entry.message}</span>
              </span>
              <span className="CNPG-row__aside">{ago(entry.at, now)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
