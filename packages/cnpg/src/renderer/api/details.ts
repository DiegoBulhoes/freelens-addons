import { backupsNewestFirst } from "./backups";
import { SCHEDULE_LABEL } from "./rows";
import type { BackupLike, ScheduledBackupLike } from "./types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (value: string) => value.padStart(2, "0");

/** CloudNativePG's six-field cron (seconds first), in words for the common shapes; else as written. */
export function describeCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);

  if (fields.length !== 6) return cron;

  const [second, minute, hour, day, month, weekday] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const fixed = (value: string) => /^\d+$/.test(value);
  const at = (h: string) => `${pad(h)}:${pad(minute)} UTC`;

  if (second !== "0" || !fixed(minute) || month !== "*") return cron;

  if (hour === "*" && day === "*" && weekday === "*") {
    return minute === "0" ? "Every hour" : `Every hour at minute ${minute}`;
  }

  if (!fixed(hour)) return cron;
  if (day === "*" && weekday === "*") return `Daily at ${at(hour)}`;
  // 0 and 7 are both Sunday.
  if (day === "*" && fixed(weekday) && Number(weekday) <= 7) {
    return `Weekly on ${DAYS[Number(weekday) % 7]} at ${at(hour)}`;
  }
  if (fixed(day) && weekday === "*") return `Monthly on day ${day} at ${at(hour)}`;

  return cron;
}

/** The Backups a schedule started, newest first, whether or not it owns them. */
export function backupsFromSchedule(
  schedule: ScheduledBackupLike,
  backups: BackupLike[],
): BackupLike[] {
  return backupsNewestFirst(
    backups.filter(
      (backup) =>
        backup.getNs() === schedule.getNs() &&
        backup.metadata.labels?.[SCHEDULE_LABEL] === schedule.getName(),
    ),
  );
}

export function entriesOf(record: Record<string, string> | undefined): [string, string][] {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}
