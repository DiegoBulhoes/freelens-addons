import { describe, expect, it } from "vitest";

import { backupsFromSchedule, describeCron, entriesOf } from "../src/renderer/api/details";
import { backups, scheduleNamed, schedules } from "./fixtures";

describe("a schedule's cron, in words", () => {
  it("reads the dev cluster's schedules", () => {
    expect(
      schedules().map((schedule) => [schedule.getName(), describeCron(schedule.spec.schedule)]),
    ).toEqual(
      expect.arrayContaining([
        ["orders-hourly", "Every hour"],
        ["billing-nightly", "Daily at 02:00 UTC"],
        ["orders-weekly", "Weekly on Sunday at 03:00 UTC"],
      ]),
    );
  });

  it("reads the other common shapes", () => {
    expect(describeCron("0 15 * * * *")).toBe("Every hour at minute 15");
    expect(describeCron("0 30 4 1 * *")).toBe("Monthly on day 1 at 04:30 UTC");
    expect(describeCron("0 0 3 * * 7")).toBe("Weekly on Sunday at 03:00 UTC");
  });

  it("leaves anything else as written", () => {
    for (const cron of [
      "0 */5 * * * *",
      "30 0 2 * * *",
      "0 0 */6 * * *",
      "0 0 2 * 1 *",
      "0 0 2 1 * 1",
      "@daily",
      "0 0 2 * * 9",
    ]) {
      expect(describeCron(cron)).toBe(cron);
    }
  });
});

describe("what a schedule started", () => {
  it("lists its own Backups, newest first", () => {
    const started = backupsFromSchedule(scheduleNamed("orders-hourly"), backups());

    expect(started.length).toBeGreaterThan(0);
    expect(started.every((backup) => backup.getName().startsWith("orders-hourly-"))).toBe(true);
    expect(backupsFromSchedule(scheduleNamed("orders-weekly"), backups())).toEqual([]);
  });
});

describe("a record's entries", () => {
  it("sorts them by key, and has none for nothing", () => {
    expect(entriesOf({ b: "2", a: "1" })).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(entriesOf(undefined)).toEqual([]);
  });
});
