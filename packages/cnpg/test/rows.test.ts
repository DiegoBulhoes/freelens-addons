import { describe, expect, it } from "vitest";

import { backupsNewestFirst } from "../src/renderer/api/backups";
import {
  backupDuration,
  backupsOf,
  backupVerdict,
  poolersOf,
  poolerVerdict,
  schedulesOf,
  scheduleVerdict,
} from "../src/renderer/api/rows";
import {
  backups,
  clusterNamed,
  clusters,
  fixtureNow,
  poolerNamed,
  poolers,
  scheduleNamed,
  variantOf,
} from "./fixtures";

const backupNamed = (prefix: string) => {
  const found = backups().find((backup) => backup.getName().startsWith(prefix));
  if (!found) throw new Error(`no backup starting with ${prefix}`);
  return found;
};

describe("a backup's state", () => {
  it("reads completed, and failed with the operator's error", () => {
    expect(backupVerdict(backupNamed("orders-hourly"))).toMatchObject({
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
    const own = backupsOf(clusterNamed("orders-db"), backups());

    expect(own.length).toBeGreaterThan(0);
    expect(own.every((backup) => backup.spec.cluster.name === "orders-db")).toBe(true);
    expect(own).toEqual(backupsNewestFirst(own));
    expect(backupsOf(clusterNamed("inventory-db"), backups())).toEqual([]);
  });
});

describe("a schedule's state", () => {
  const now = fixtureNow();

  it("is active with a next run, and suspended when suspended", () => {
    expect(
      scheduleVerdict(scheduleNamed("orders-hourly"), clusters(), backups(), now),
    ).toMatchObject({
      tone: "ok",
      label: "Active",
    });
    expect(
      scheduleVerdict(scheduleNamed("orders-weekly"), clusters(), backups(), now),
    ).toMatchObject({
      tone: "warning",
      label: "Suspended",
    });
  });

  it("reports the failure of the last backup it started", () => {
    expect(
      scheduleVerdict(scheduleNamed("billing-nightly"), clusters(), backups(), now),
    ).toMatchObject({
      tone: "critical",
      label: "Last run failed",
    });
    expect(
      scheduleVerdict(scheduleNamed("billing-nightly"), clusters(), backups(), now).reason,
    ).toMatch(/failed: rpc error/);

    const silent = backups().map((backup) =>
      variantOf(backup, (raw) => {
        if (raw.status) raw.status.error = undefined;
      }),
    );

    expect(
      scheduleVerdict(scheduleNamed("billing-nightly"), clusters(), silent, now).reason,
    ).toMatch(/failed\.$/);
  });

  it("is waiting before its first run, and broken without its cluster", () => {
    const waiting = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.status = undefined;
    });
    const orphan = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.cluster.name = "gone-db";
    });

    expect(scheduleVerdict(waiting, clusters(), [], now).reason).toBe("Waiting for its first run.");
    expect(scheduleVerdict(orphan, clusters(), backups(), now)).toMatchObject({
      tone: "critical",
      label: "Cluster missing",
    });
  });

  it("belongs to its cluster", () => {
    expect(
      schedulesOf(clusterNamed("orders-db"), [
        scheduleNamed("orders-hourly"),
        scheduleNamed("billing-nightly"),
      ]).map((s) => s.getName()),
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

  it("belongs to its cluster", () => {
    expect(
      poolersOf(clusterNamed("orders-db"), poolers())
        .map((p) => p.getName())
        .sort(),
    ).toEqual(["orders-ro", "orders-rw"]);
  });
});
