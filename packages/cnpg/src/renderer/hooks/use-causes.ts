import { useEffect, useState } from "react";
import {
  backupLogSource,
  causeSourceOf,
  type LogSource,
  logSourceKey,
} from "../api/backups/causes";
import type { BackupLike, ClusterLike } from "../api/shared/types";
import { readCause } from "../api/writes/actions";

const CAUSE_FRESH_MS = 60_000;
// By pod and container: a standby's backup and the primary's archiving write to different logs.
const causesBySource = new Map<string, { at: number; cause?: string }>();

interface Wanted {
  key: string;
  namespace: string | undefined;
  source: LogSource;
}

function useSourcedCauses(wanted: Wanted[]): Map<string, string> {
  const [, setVersion] = useState(0);
  const keys = wanted
    .map((each) => logSourceKey(each.namespace, each.source))
    .sort()
    .join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keys stands for the sources, which are fresh objects every render.
  useEffect(() => {
    let cancelled = false;

    for (const { namespace, source } of wanted) {
      const key = logSourceKey(namespace, source);
      const known = causesBySource.get(key);

      if (known && Date.now() - known.at < CAUSE_FRESH_MS) continue;

      causesBySource.set(key, { at: Date.now(), cause: known?.cause });
      void readCause(namespace, source)
        .then((cause) => causesBySource.set(key, { at: Date.now(), cause }))
        .catch(() => undefined)
        .then(() => {
          if (!cancelled) setVersion((version) => version + 1);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [keys]);

  const found = new Map<string, string>();

  for (const each of wanted) {
    const cause = causesBySource.get(logSourceKey(each.namespace, each.source))?.cause;

    if (cause) found.set(each.key, cause);
  }

  return found;
}

export interface CauseWanted {
  key: string;
  cluster: ClusterLike | undefined;
  label: string;
  failed?: BackupLike;
}

/** Barman's last error behind each verdict given, from the log that holds it; a minute old at most. */
export function useCauses(wanted: CauseWanted[]): Map<string, string> {
  return useSourcedCauses(
    wanted.flatMap(({ key, cluster, label, failed }) => {
      if (!cluster) return [];

      const source = causeSourceOf(cluster, label, failed);

      return source ? [{ key, namespace: cluster.getNs(), source }] : [];
    }),
  );
}

/** Barman's last error from the instance that ran the backup. */
export function useBackupCause(
  backup: BackupLike | undefined,
  cluster: ClusterLike | undefined,
): string | undefined {
  const source = backup && cluster ? backupLogSource(cluster, backup) : undefined;

  return useSourcedCauses(
    backup && source ? [{ key: "backup", namespace: backup.getNs(), source }] : [],
  ).get("backup");
}
