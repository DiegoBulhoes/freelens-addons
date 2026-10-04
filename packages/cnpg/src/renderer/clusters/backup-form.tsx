import { useState } from "react";

import type { BackupOptions, BackupTarget } from "../api/operations";
import type { BackupMethod } from "../api/types";

const METHOD_LABELS: Record<BackupMethod, string> = {
  plugin: "Plugin",
  barmanObjectStore: "Object store",
  volumeSnapshot: "Volume snapshot",
};

const TARGETS: { value?: BackupTarget; label: string; title: string }[] = [
  {
    label: "Cluster default",
    title: "Uses the target set on the cluster, a standby unless it says otherwise",
  },
  {
    value: "prefer-standby",
    label: "Prefer a standby",
    title: "Takes it from a replica when one is healthy",
  },
  { value: "primary", label: "Primary", title: "Takes it from the primary" },
];

/** Reports through a callback: the dialog copies plain-object props. */
export function BackupOptionsForm({
  methods,
  onChange,
}: {
  methods: BackupMethod[];
  onChange: (options: BackupOptions) => void;
}) {
  const [options, setOptions] = useState<BackupOptions>({ method: methods[0] });
  const change = (next: BackupOptions) => {
    const updated = { ...options, ...next };

    setOptions(updated);
    onChange(updated);
  };

  return (
    <>
      {methods.length > 1 && (
        <div className="CNPG-form__field">
          <span>Method</span>
          <div className="CNPG-filters">
            {methods.map((method) => (
              <button
                key={method}
                type="button"
                className="CNPG-filter"
                aria-pressed={options.method === method}
                title={`Backs up with ${METHOD_LABELS[method].toLowerCase()}`}
                onClick={() => change({ method })}
              >
                {METHOD_LABELS[method]}
              </button>
            ))}
          </div>
        </div>
      )}
      {options.method === "volumeSnapshot" && (
        <div className="CNPG-form__field">
          <span>Snapshot settings</span>
          <div className="CNPG-filters">
            <button
              type="button"
              className="CNPG-filter"
              aria-pressed={options.online === false}
              title="Stops Postgres on the instance for a cold, self-consistent copy"
              onClick={() => change({ online: options.online === false ? undefined : false })}
            >
              Offline
            </button>
            <button
              type="button"
              className="CNPG-filter"
              aria-pressed={options.immediateCheckpoint === true}
              disabled={options.online === false}
              title="Checkpoints at once instead of spreading the I/O, so the snapshot starts sooner"
              onClick={() =>
                change({ immediateCheckpoint: options.immediateCheckpoint ? undefined : true })
              }
            >
              Immediate checkpoint
            </button>
            <button
              type="button"
              className="CNPG-filter"
              aria-pressed={options.waitForArchive === false}
              disabled={options.online === false}
              title="Completes without waiting for the closing WAL to be archived; the backup may not restore on its own"
              onClick={() =>
                change({ waitForArchive: options.waitForArchive === false ? undefined : false })
              }
            >
              Skip waiting for the archive
            </button>
          </div>
          {options.online === false && (
            <span className="CNPG-text--critical">
              Postgres stops on the instance until the snapshot is taken.
            </span>
          )}
          {options.online !== false && options.waitForArchive === false && (
            <span className="CNPG-text--warning">
              Without its closing WAL archived, this backup may not restore on its own.
            </span>
          )}
        </div>
      )}
      <div className="CNPG-form__field">
        <span>Take it from</span>
        <div className="CNPG-filters">
          {TARGETS.map((target) => (
            <button
              key={target.label}
              type="button"
              className="CNPG-filter"
              aria-pressed={options.target === target.value}
              title={target.title}
              onClick={() => change({ target: target.value })}
            >
              {target.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
