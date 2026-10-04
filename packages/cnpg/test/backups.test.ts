import { describe, expect, it } from "vitest";

import {
  ago,
  backupConfig,
  backupFacts,
  backupHealth,
  backupTime,
  formatAge,
  STALE_AFTER_MS,
} from "../src/renderer/api/backups";
import { backups, clusterNamed, fixtureNow, objectStores, schedules, variantOf } from "./fixtures";

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
