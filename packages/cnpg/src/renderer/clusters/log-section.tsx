import { useEffect, useState } from "react";

import { readInstanceLogs } from "../api/actions";
import { ago } from "../api/backups";
import { type LogEntry, type LogLevel, mergeLogs } from "../api/logs";
import type { ClusterLike } from "../api/types";

const LEVELS: { value: LogLevel; label: string }[] = [
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "All" },
];
const SHOWN = 40;

/** Every instance's postgres log in one stream, as `kubectl cnpg logs cluster` gives it. */
export function LogSection({ cluster }: { cluster: ClusterLike }) {
  const [level, setLevel] = useState<LogLevel>("warning");
  const [texts, setTexts] = useState<string[]>();
  const key = `${cluster.getNs()}/${cluster.getName()}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the cluster, a fresh object every render.
  useEffect(() => {
    let cancelled = false;

    setTexts(undefined);
    void readInstanceLogs(cluster, 300).then((read) => {
      if (!cancelled) setTexts(read);
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const entries: LogEntry[] = texts ? mergeLogs(texts, level, SHOWN) : [];
  const now = Date.now();

  return (
    <section className="CNPG-section" data-section="cnpg-log">
      <div className="CNPG-section__bar">
        <h3 className="CNPG-section__title">Recent log</h3>
        <div className="CNPG-filters">
          {LEVELS.map((each) => (
            <button
              key={each.value}
              type="button"
              className="CNPG-filter"
              aria-pressed={level === each.value}
              title={`Shows ${each.label.toLowerCase()} from every instance`}
              onClick={() => setLevel(each.value)}
            >
              {each.label}
            </button>
          ))}
        </div>
      </div>
      {!texts ? (
        <p className="CNPG-section__note">Reading the instances' logs…</p>
      ) : entries.length === 0 ? (
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
