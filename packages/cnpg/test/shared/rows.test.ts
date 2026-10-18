import { describe, expect, it } from "vitest";
import { backupsNewestFirst, belongsTo } from "../../src/renderer/api/backups/backups";
import {
  backupDuration,
  backupVerdict,
  describePoolerReady,
  indexInventory,
  poolerReady,
  poolersOf,
  poolerVerdict,
  scheduleVerdict,
} from "../../src/renderer/api/shared/rows";
import { until } from "../../src/renderer/api/shared/verdict";
import {
  backups,
  clusterNamed,
  clusters,
  fixtureNow,
  pods,
  poolerNamed,
  poolers,
  scheduleNamed,
  schedules,
  variantOf,
} from "../support/fixtures";

const backupNamed = (prefix: string) => {
  const found = backups().find((backup) => backup.getName().startsWith(prefix));
  if (!found) throw new Error(`no backup starting with ${prefix}`);
  return found;
};

describe("a backup's state", () => {
  it("reads completed, and failed with the operator's error", () => {
    expect(backupVerdict(backupNamed("orders-hourly-20261012200000"))).toMatchObject({
      tone: "ok",
      label: "Completed",
    });
    expect(backupVerdict(backupNamed("billing-nightly"))).toMatchObject({
      tone: "critical",
      label: "Failed",
      reason: "rpc error: code = Unknown desc = exit status 1",
    });
  });

  it("reads a phase in progress as it is, and none as pending", () => {
    const running = variantOf(backupNamed("orders-hourly"), (raw) => {
      raw.status.phase = "running";
    });
    const fresh = variantOf(backupNamed("orders-hourly"), (raw) => {
      raw.status = undefined;
    });
    const archiving = variantOf(backupNamed("orders-hourly"), (raw) => {
      raw.status.phase = "walArchivingFailing";
    });

    expect(backupVerdict(running)).toMatchObject({ tone: "info", label: "Running" });
    expect(backupVerdict(fresh)).toMatchObject({ tone: "info", label: "Pending" });
    expect(backupVerdict(archiving).tone).toBe("critical");

    const silent = variantOf(backupNamed("billing-nightly"), (raw) => {
      raw.status.error = undefined;
    });
    const silentArchiving = variantOf(silent, (raw) => {
      raw.status.phase = "walArchivingFailing";
    });

    expect(backupVerdict(silent).reason).toBe("Failed.");
    expect(backupVerdict(silentArchiving).reason).toBe("");
  });

  it("measures how long it took, when both ends are known", () => {
    expect(backupDuration(backupNamed("orders-hourly"))).toMatch(/^\d+s$/);

    const slow = variantOf(backupNamed("orders-hourly"), (raw) => {
      raw.status.startedAt = "2026-01-01T00:00:00Z";
      raw.status.stoppedAt = "2026-01-01T00:10:00Z";
    });
    const open = variantOf(backupNamed("orders-hourly"), (raw) => {
      raw.status = { phase: "running" };
    });

    expect(backupDuration(slow)).toBe("10m");
    expect(backupDuration(open)).toBeUndefined();
  });

  it("lists a cluster's backups newest first, and only its own", () => {
    const sorted = backupsNewestFirst(backups());

    expect(sorted).toHaveLength(backups().length);
    const index = indexInventory({ backups: backups(), schedules: [] });
    const own = index.backupsOf(clusterNamed("orders-db"));

    expect(own.length).toBeGreaterThan(0);
    expect(own.every((backup) => backup.spec.cluster.name === "orders-db")).toBe(true);
    expect(own).toEqual(backupsNewestFirst(own));
    expect(index.backupsOf(clusterNamed("inventory-db"))).toEqual([]);
  });
});

describe("a schedule's state", () => {
  const now = fixtureNow();
  const runs = (all: ReturnType<typeof backups>) => indexInventory({ backups: all, schedules: [] });

  it("is active with a next run, and suspended when suspended", () => {
    expect(
      scheduleVerdict(scheduleNamed("orders-hourly"), clusters(), runs(backups()), now),
    ).toMatchObject({
      tone: "ok",
      label: "Active",
      reason: `Next run ${until(scheduleNamed("orders-hourly").status?.nextScheduleTime, now)}.`,
    });
    expect(
      scheduleVerdict(scheduleNamed("orders-hourly"), clusters(), runs(backups()), now).reason,
    ).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(
      scheduleVerdict(scheduleNamed("orders-weekly"), clusters(), runs(backups()), now),
    ).toMatchObject({
      tone: "warning",
      label: "Suspended",
    });
  });

  it("reports the failure of the last backup it started", () => {
    expect(
      scheduleVerdict(scheduleNamed("billing-nightly"), clusters(), runs(backups()), now),
    ).toMatchObject({
      tone: "critical",
      label: "Last run failed",
    });
    expect(
      scheduleVerdict(scheduleNamed("billing-nightly"), clusters(), runs(backups()), now).reason,
    ).toMatch(/failed: rpc error/);

    const silent = backups().map((backup) =>
      variantOf(backup, (raw) => {
        if (raw.status) raw.status.error = undefined;
      }),
    );

    expect(
      scheduleVerdict(scheduleNamed("billing-nightly"), clusters(), runs(silent), now).reason,
    ).toMatch(/failed\.$/);
  });

  it("is waiting before its first run, and broken without its cluster", () => {
    const waiting = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.status = undefined;
    });
    const orphan = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.cluster.name = "gone-db";
    });

    expect(scheduleVerdict(waiting, clusters(), runs([]), now).reason).toBe(
      "Waiting for its first run.",
    );
    expect(scheduleVerdict(orphan, clusters(), runs(backups()), now)).toMatchObject({
      tone: "critical",
      label: "Cluster missing",
    });
  });

  it("belongs to its cluster", () => {
    expect(
      indexInventory({
        backups: [],
        schedules: [scheduleNamed("orders-hourly"), scheduleNamed("billing-nightly")],
      })
        .schedulesOf(clusterNamed("orders-db"))
        .map((s) => s.getName()),
    ).toEqual(["orders-hourly"]);
  });
});

describe("a pooler's state", () => {
  it("is active in front of a healthy cluster", () => {
    expect(poolerVerdict(poolerNamed("orders-rw"), clusters())).toMatchObject({
      tone: "ok",
      label: "Active",
    });
  });

  it("is broken when its cluster does not exist, with the operator's reason", () => {
    expect(poolerVerdict(poolerNamed("legacy-rw"), clusters())).toMatchObject({
      tone: "critical",
      label: "Cluster missing",
      reason: 'Cluster "legacy-db" not found',
    });

    const unreported = variantOf(poolerNamed("legacy-rw"), (raw) => {
      raw.status = undefined;
    });

    expect(poolerVerdict(unreported, clusters()).reason).toBe("No cluster named legacy-db.");
  });

  it("is inactive when the operator says so, and paused when paused", () => {
    const inactive = variantOf(poolerNamed("orders-rw"), (raw) => {
      raw.status = { phase: "inactive" };
    });
    const paused = variantOf(poolerNamed("orders-rw"), (raw) => {
      raw.spec.pgbouncer.paused = true;
    });

    expect(poolerVerdict(inactive, clusters())).toMatchObject({
      label: "Inactive",
      reason: "The operator reports it inactive.",
    });
    expect(poolerVerdict(paused, clusters())).toMatchObject({ tone: "warning", label: "Paused" });
  });

  it("warns when its cluster is down or hibernated", () => {
    const toAnalytics = variantOf(poolerNamed("orders-rw"), (raw) => {
      raw.spec.cluster.name = "analytics-db";
    });
    const toReports = variantOf(poolerNamed("orders-rw"), (raw) => {
      raw.spec.cluster.name = "reports-db";
    });

    expect(poolerVerdict(toAnalytics, clusters())).toMatchObject({
      tone: "warning",
      label: "Cluster unavailable",
    });
    expect(poolerVerdict(toReports, clusters()).reason).toBe("Its cluster is hibernated.");
  });

  it("counts its ready PgBouncer pods against those it wants", () => {
    expect(poolerReady(poolerNamed("orders-rw"), pods())).toEqual({ ready: 2, wanted: 2 });
    expect(poolerReady(poolerNamed("orders-ro"), pods())).toEqual({ ready: 1, wanted: 1 });
    expect(poolerReady(poolerNamed("legacy-rw"), pods())).toEqual({ ready: 0, wanted: 1 });
    expect(poolerReady(poolerNamed("orders-rw"), undefined)).toBeUndefined();
    expect(describePoolerReady(poolerReady(poolerNamed("orders-rw"), pods()))).toBe("2/2");
    expect(describePoolerReady(undefined)).toBe("—");

    const elsewhere = pods().map((pod) =>
      variantOf(pod, (raw) => {
        raw.metadata.namespace = "staging";
      }),
    );

    expect(poolerReady(poolerNamed("orders-rw"), elsewhere)?.ready).toBe(0);
  });

  it("is down with no ready pod, and degraded with fewer than it wants", () => {
    const crashing = pods().map((pod) =>
      pod.metadata.labels?.["cnpg.io/poolerName"] === "orders-rw"
        ? variantOf(pod, (raw) => {
            for (const condition of raw.status.conditions) {
              if (condition.type === "Ready") condition.status = "False";
            }
          })
        : pod,
    );
    const oneLost = pods().filter((pod) => pod.getName() !== "orders-rw-6757c6566-vn29p");
    const single = crashing.filter((pod) => pod.getName() !== "orders-rw-6757c6566-vn29p");
    const one = variantOf(poolerNamed("orders-rw"), (raw) => {
      raw.spec.instances = 1;
    });

    expect(poolerVerdict(poolerNamed("orders-rw"), clusters(), pods())).toMatchObject({
      tone: "ok",
      label: "Active",
    });
    expect(poolerVerdict(poolerNamed("orders-rw"), clusters(), crashing)).toMatchObject({
      tone: "critical",
      label: "No ready pod",
      reason: "None of its 2 PgBouncer pods is ready, so nothing reaches orders-db through it.",
    });
    expect(poolerVerdict(one, clusters(), single).reason).toBe(
      "Its PgBouncer pod is not ready, so nothing reaches orders-db through it.",
    );
    expect(poolerVerdict(poolerNamed("orders-rw"), clusters(), oneLost)).toMatchObject({
      tone: "warning",
      label: "Degraded",
      reason: "1 of its 2 PgBouncer pods are ready.",
    });
    expect(poolerVerdict(poolerNamed("orders-rw"), clusters(), undefined).label).toBe("Active");
  });

  it("wants no pod when scaled to none", () => {
    const none = variantOf(poolerNamed("orders-rw"), (raw) => {
      raw.spec.instances = 0;
    });

    expect(poolerVerdict(none, clusters(), [])).toMatchObject({ tone: "ok", label: "Active" });
  });

  it("belongs to its cluster", () => {
    expect(
      poolersOf(clusterNamed("orders-db"), poolers())
        .map((p) => p.getName())
        .sort(),
    ).toEqual(["orders-ro", "orders-rw"]);
  });
});

describe("the backups and schedules, grouped once", () => {
  const index = indexInventory({ backups: backups(), schedules: schedules() });
  const names = (items: { getName(): string }[]) => items.map((item) => item.getName());

  it("gives each cluster its own backups, newest first, as a scan does", () => {
    for (const cluster of clusters()) {
      expect(names(index.backupsOf(cluster))).toEqual(
        names(backupsNewestFirst(backups().filter((backup) => belongsTo(backup, cluster)))),
      );
      expect(names(index.schedulesOf(cluster))).toEqual(
        names(schedules().filter((schedule) => belongsTo(schedule, cluster))),
      );
    }
  });

  it("keeps namespaces apart", () => {
    const moved = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.metadata.namespace = "staging";
    });

    expect(index.backupsOf(moved)).toEqual([]);
    expect(index.schedulesOf(moved)).toEqual([]);
    const movedSchedule = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.metadata.namespace = "staging";
    });

    expect(index.lastRunOf(movedSchedule)).toBeUndefined();
  });

  it("finds the newest run each schedule started", () => {
    const runsOf = (schedule: string) =>
      backups().filter(
        (backup) => backup.metadata.labels?.["cnpg.io/scheduled-backup"] === schedule,
      );
    const newestOf = (schedule: string) => backupsNewestFirst(runsOf(schedule))[0]?.getName();

    expect(index.lastRunOf(scheduleNamed("orders-hourly"))?.getName()).toBe(
      newestOf("orders-hourly"),
    );
    expect(index.lastRunOf(scheduleNamed("billing-nightly"))?.getName()).toBe(
      newestOf("billing-nightly"),
    );
    // The export lists them oldest first, so taking the first match would fail here.
    expect(newestOf("orders-hourly")).not.toBe(runsOf("orders-hourly")[0]?.getName());
    expect(index.lastRunOf(scheduleNamed("orders-weekly"))).toBeUndefined();
  });
});
