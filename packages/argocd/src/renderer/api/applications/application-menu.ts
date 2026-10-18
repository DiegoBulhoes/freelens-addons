import type { RevisionHistory } from "../shared/types";
import {
  autoSyncOf,
  autoSyncToResume,
  isSyncRunning,
  operationInProgress,
  rollbackTargetsOf,
} from "../writes/patches";
import type { Application } from "./application";
import { getCompareUrl } from "./insights";

export const MAX_ROLLBACK_TARGETS = 3;

export type ApplicationMenuEntry =
  | {
      kind:
        | "logs"
        | "refresh"
        | "hard-refresh"
        | "copy-sync"
        | "copy-patch"
        | "copy-summary"
        | "pin"
        | "resume-auto-sync"
        | "sync"
        | "terminate";
    }
  | { kind: "compare"; url: string }
  | { kind: "rollback"; deploy: RevisionHistory & { id: number } };

/** Writes after Pin and roll back last, as design.md puts destructive items last. */
export function applicationMenuEntries(application: Application): ApplicationMenuEntry[] {
  const entries: ApplicationMenuEntry[] = [
    { kind: "logs" },
    { kind: "refresh" },
    { kind: "hard-refresh" },
  ];
  const compareUrl = getCompareUrl(application);
  const busy = operationInProgress(application);

  if (compareUrl) entries.push({ kind: "compare", url: compareUrl });

  entries.push(
    { kind: "copy-sync" },
    { kind: "copy-patch" },
    { kind: "copy-summary" },
    { kind: "pin" },
  );

  if (autoSyncToResume(application)) entries.push({ kind: "resume-auto-sync" });
  if (!busy) entries.push({ kind: "sync" });
  if (isSyncRunning(application)) entries.push({ kind: "terminate" });
  if (!busy) {
    for (const deploy of rollbackTargetsOf(application, MAX_ROLLBACK_TARGETS)) {
      entries.push({ kind: "rollback", deploy });
    }
  }

  return entries;
}

/** As planRollback: only an automated sync that is on gets turned off. */
export function rollbackTooltip(application: Application): string {
  return autoSyncOf(application)
    ? "Syncs this deploy's revisions and sources, and turns automated sync off"
    : "Syncs this deploy's revisions and sources";
}
