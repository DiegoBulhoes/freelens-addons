import { describe, expect, it } from "vitest";
import {
  backupConfig,
  backupFacts,
  backupHealth,
  backupTime,
  STALE_AFTER_MS,
  scheduleInterval,
  staleAfter,
} from "../../src/renderer/api/backups/backups";
import { ago, formatAge } from "../../src/renderer/api/shared/verdict";
import {
  backups,
  clusterNamed,
  fixtureNow,
  objectStores,
  scheduleNamed,
  schedules,
  variantOf,
} from "../support/fixtures";

const factsOf = (name: string) =>
  backupFacts(clusterNamed(name), backups(), schedules(), objectStores());

describe("how a cluster is backed up", () => {
  it("reads the plugin and its ObjectStore", () => {
    expect(backupConfig(clusterNamed("orders-db"))).toEqual({
      method: "plugin",
      plugin: "barman-cloud.cloudnative-pg.io",
      objectStore: "backups",
      archivesWal: true,
    });
  });

  it("reads the in-tree object store and volume snapshots", () => {
    const inTree = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.backup = { barmanObjectStore: { destinationPath: "s3://x/" } };
    });
    const snapshots = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.backup = { volumeSnapshot: { className: "csi" } };
    });

    expect(backupConfig(inTree)).toEqual({ method: "barmanObjectStore", archivesWal: true });
    expect(backupConfig(snapshots)).toEqual({ method: "volumeSnapshot", archivesWal: false });
  });

  it("finds nothing when no method is configured, and ignores a disabled archiver", () => {
    expect(backupConfig(clusterNamed("inventory-db"))).toEqual({ archivesWal: false });

    const disabled = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.plugins[0].enabled = false;
    });

    expect(backupConfig(disabled).method).toBeUndefined();
  });

  it("does not name an ObjectStore for another vendor's plugin", () => {
    const other = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.plugins[0].name = "wal-g.example.test";
    });

    expect(backupConfig(other)).toEqual({
      method: "plugin",
      plugin: "wal-g.example.test",
      objectStore: undefined,
      archivesWal: true,
    });
  });
});

describe("what is known about a cluster's backups", () => {
  it("reads the window the plugin keeps under its serverName, not the cluster's name", () => {
    const renamed = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.plugins[0].parameters.serverName = "orders-db-v2";
      raw.status.firstRecoverabilityPoint = undefined;
    });
    const stores = objectStores().map((store) =>
      variantOf(store, (raw) => {
        const windows = raw.status?.serverRecoveryWindow;

        if (windows?.["orders-db"]) {
          windows["orders-db-v2"] = {
            ...windows["orders-db"],
            firstRecoverabilityPoint: "2026-10-12T19:30:00Z",
          };
          delete windows["orders-db"];
        }
      }),
    );

    expect(backupConfig(renamed).serverName).toBe("orders-db-v2");
    expect(backupFacts(renamed, backups(), schedules(), stores).recoverableFrom).toBe(
      "2026-10-12T19:30:00Z",
    );
    expect(
      backupFacts(renamed, backups(), schedules(), objectStores()).recoverableFrom,
    ).toBeUndefined();
  });

  it("takes the recovery window from the plugin's ObjectStore", () => {
    const facts = factsOf("orders-db");

    expect(facts.lastSuccess).toBeDefined();
    expect(facts.recoverableFrom).toBe(
      objectStores().find((store) => store.getName() === "backups")?.status?.serverRecoveryWindow?.[
        "orders-db"
      ]?.firstRecoverabilityPoint,
    );
    expect(facts.archiving).toBe("working");
    expect(facts).toMatchObject({ schedules: 2, activeSchedules: 1 });
  });

  it("knows archiving fails and the last backup failed, with its error", () => {
    const facts = factsOf("billing-db");

    expect(facts.archiving).toBe("failing");
    expect(facts.archivingMessage).toContain("barman-cloud-wal-archive");
    expect(facts.lastSuccess).toBeUndefined();
    expect(facts.lastFailure).toBeDefined();
    expect(facts.lastError).toContain("exit status 1");
  });

  it("dates the last failure by the newest of its sources", () => {
    const stale = variantOf(clusterNamed("billing-db"), (raw) => {
      raw.status.lastFailedBackup = "2026-10-11T16:53:14Z";
    });

    expect(backupFacts(stale, backups(), schedules(), objectStores()).lastFailure).toBe(
      "2026-10-18T02:00:00Z",
    );
  });

  it("dates the last success by the newest of its sources", () => {
    const stale = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.lastSuccessfulBackup = "2026-10-12T18:00:00Z";
    });

    expect(backupFacts(stale, backups(), schedules(), objectStores()).lastSuccess).toBe(
      "2026-10-18T02:00:01Z",
    );
  });

  it("ignores the archiving condition when nothing archives", () => {
    const inventory = clusterNamed("inventory-db");

    expect(inventory.status?.conditions?.some((c) => c.type === "ContinuousArchiving")).toBe(true);
    expect(factsOf("inventory-db").archiving).toBeUndefined();
  });

  it("dates a backup by when it stopped, else when it was reconciled, else created", () => {
    const [first] = backups();
    if (!first) throw new Error("no backups in the fixtures");

    const created = variantOf(first, (raw) => {
      raw.status = undefined;
    });

    expect(backupTime(first)).toBeDefined();
    expect(backupTime(created)).toBe(first.metadata.creationTimestamp);

    const undated = variantOf(first, (raw) => {
      raw.status = undefined;
      raw.metadata.creationTimestamp = undefined;
    });

    expect(backupTime(undated)).toBe("");
  });
});

describe("whether a cluster can be restored", () => {
  const now = fixtureNow();

  it("is backed up with a recent backup, a schedule and archiving working", () => {
    const health = backupHealth(factsOf("orders-db"), clusterNamed("orders-db"), now);

    expect(health).toMatchObject({ tone: "ok", label: "Backed up" });
    expect(health.reason).toContain("recoverable since");
  });

  it("cannot be restored with no method and no backup", () => {
    expect(backupHealth(factsOf("inventory-db"), clusterNamed("inventory-db"), now)).toMatchObject({
      tone: "critical",
      label: "No backup",
    });
  });

  it("calls a replica cluster with no method of its own a replica, not unrestorable", () => {
    // inventory-db already names orders-db as an external cluster: here it replays it.
    const replica = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.replica = { enabled: true, source: "orders" };
    });

    expect(backupHealth(factsOf("inventory-db"), replica, now)).toEqual({
      tone: "info",
      label: "Replica cluster",
      reason:
        "It replays external cluster orders and has no backup method of its own; the source's backups restore it.",
    });
  });

  it("calls the seeded replica of orders-db a replica cluster", () => {
    expect(
      backupHealth(factsOf("orders-replica-db"), clusterNamed("orders-replica-db"), now).label,
    ).toBe("Replica cluster");
  });

  it("still calls a replica cluster with a method of its own, never backed up, not backed up yet", () => {
    const replica = variantOf(clusterNamed("audit-db"), (raw) => {
      raw.spec.replica = { enabled: true, source: "orders" };
    });

    expect(backupHealth(factsOf("audit-db"), replica, now).label).toBe("No backup yet");
  });

  it("puts failing archiving first: the recovery window stops growing", () => {
    expect(backupHealth(factsOf("billing-db"), clusterNamed("billing-db"), now)).toMatchObject({
      tone: "critical",
      label: "Archiving failing",
    });
  });

  it("reports a failed last backup when archiving works", () => {
    const facts = { ...factsOf("billing-db"), archiving: "working" as const };

    expect(backupHealth(facts, clusterNamed("billing-db"), now)).toMatchObject({
      tone: "critical",
      label: "Last backup failed",
    });
  });

  it("is backed up when a success follows the failures", () => {
    // The seed's orders-hourly failed until 19:00 on the 12th and has completed since.
    const facts = factsOf("orders-db");

    expect(facts).toMatchObject({
      lastFailure: "2026-10-12T19:00:00Z",
      lastSuccess: "2026-10-18T02:00:01Z",
    });
    expect(backupHealth(facts, clusterNamed("orders-db"), now).label).toBe("Backed up");
  });

  it("reports the failure that follows the last success", () => {
    const stores = objectStores().map((store) =>
      variantOf(store, (raw) => {
        const window = raw.status?.serverRecoveryWindow?.["orders-db"];

        if (window) window.lastFailedBackupTime = "2026-10-18T02:01:00Z";
      }),
    );
    const facts = backupFacts(clusterNamed("orders-db"), backups(), schedules(), stores);

    expect(facts.lastFailure).toBe("2026-10-18T02:01:00Z");
    expect(backupHealth(facts, clusterNamed("orders-db"), now)).toMatchObject({
      tone: "critical",
      label: "Last backup failed",
    });
  });

  it("does not blame archiving on a hibernated cluster", () => {
    const facts = { ...factsOf("billing-db"), archiving: "failing" as const };
    const hibernated = variantOf(clusterNamed("billing-db"), (raw) => {
      raw.metadata.annotations = { "cnpg.io/hibernation": "on" };
    });

    expect(backupHealth(facts, hibernated, now).label).toBe("Last backup failed");
  });

  it("warns when a method exists but no backup has completed", () => {
    const facts = { ...factsOf("orders-db"), lastSuccess: undefined, lastFailure: undefined };

    expect(backupHealth(facts, clusterNamed("orders-db"), now)).toMatchObject({
      tone: "warning",
      label: "No backup yet",
    });
  });

  it("warns when the last backup is older than a missed day", () => {
    const facts = factsOf("orders-db");
    const later = Date.parse(facts.lastSuccess ?? "") + STALE_AFTER_MS + 60_000;

    expect(backupHealth(facts, clusterNamed("orders-db"), later)).toMatchObject({
      tone: "warning",
      label: "Backup is old",
    });
  });

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  // orders-weekly, resumed, with a week between its last run and its next.
  const weekly = () =>
    variantOf(scheduleNamed("orders-weekly"), (raw) => {
      raw.spec.suspend = false;
      raw.status.lastScheduleTime = "2026-10-11T03:00:00Z";
      raw.status.nextScheduleTime = "2026-10-18T03:00:00Z";
    });
  const weeklyFacts = () =>
    backupFacts(clusterNamed("orders-db"), backups(), [weekly()], objectStores());

  it("expects a backup as often as the most frequent active schedule runs", () => {
    expect(factsOf("orders-db").interval).toBe(HOUR);
    expect(weeklyFacts().interval).toBe(7 * DAY);
    expect(scheduleInterval([weekly(), scheduleNamed("orders-hourly")])).toBe(HOUR);
    // Suspended, or never run: no interval to go by.
    const neverRun = variantOf(scheduleNamed("legacy-nightly"), (raw) => {
      raw.status.lastScheduleTime = undefined;
    });
    const none = [scheduleNamed("orders-weekly"), neverRun];

    expect(scheduleInterval(none)).toBeUndefined();

    const pausedHourly = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.suspend = true;
    });

    expect(scheduleInterval([weekly(), pausedHourly])).toBe(7 * DAY);
  });

  it("calls an hourly backup old once a run is missed, not after a day", () => {
    const facts = factsOf("orders-db");
    const last = Date.parse(facts.lastSuccess ?? "");
    const health = (at: number) => backupHealth(facts, clusterNamed("orders-db"), at);

    expect(health(last + 90 * 60_000).label).toBe("Backed up");
    expect(health(last + 2 * HOUR + 60_000)).toMatchObject({
      tone: "warning",
      label: "Backup is old",
      reason: expect.stringContaining("its schedule runs every 1h"),
    });
  });

  it("keeps a weekly backup fresh all week, and old once its run is missed", () => {
    const facts = weeklyFacts();
    const last = Date.parse(facts.lastSuccess ?? "");
    const health = (at: number) => backupHealth(facts, clusterNamed("orders-db"), at);

    expect(health(last + 6 * DAY).label).toBe("Backed up");
    // A week's grace is 7h, a day's share of it.
    expect(health(last + 7 * DAY + 6 * HOUR).label).toBe("Backed up");
    expect(health(last + 7 * DAY + 8 * HOUR).label).toBe("Backup is old");
  });

  it("falls back to a missed day without an active schedule that has run", () => {
    expect(staleAfter(undefined)).toBe(STALE_AFTER_MS);
    expect(staleAfter(DAY)).toBe(STALE_AFTER_MS);

    const facts = { ...factsOf("orders-db"), interval: undefined };
    const last = Date.parse(facts.lastSuccess ?? "");
    const health = (at: number) => backupHealth(facts, clusterNamed("orders-db"), at);

    expect(health(last + 24 * HOUR).label).toBe("Backed up");
    expect(health(last + STALE_AFTER_MS + 60_000)).toMatchObject({
      label: "Backup is old",
      reason: expect.not.stringContaining("schedule"),
    });
  });

  it("warns when nothing schedules the next backup", () => {
    const facts = { ...factsOf("orders-db"), activeSchedules: 0 };

    expect(backupHealth(facts, clusterNamed("orders-db"), now)).toMatchObject({
      tone: "warning",
      label: "No schedule",
    });
  });

  it("is backed up by a past backup even without a method left", () => {
    const facts = { ...factsOf("orders-db"), config: { archivesWal: false } };

    expect(backupHealth(facts, clusterNamed("orders-db"), now).tone).toBe("ok");
  });
});

describe("how long ago", () => {
  it("rounds to the largest unit that reads well", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(72 * 3_600_000)).toBe("3d");
  });

  it("shows a dash for no time, or one that does not parse", () => {
    expect(ago(undefined, 0)).toBe("—");
    expect(ago("not a date", 0)).toBe("—");
    expect(ago(new Date(0).toISOString(), 120_000)).toBe("2m ago");
    expect(ago(new Date(0).toISOString(), 10_000)).toBe("just now");
  });
});
