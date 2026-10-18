import { describe, expect, it } from "vitest";

import {
  backupCandidates,
  backupManifest,
  backupMethods,
  ownedBackups,
  pickedBackup,
  scheduleBackupManifest,
  scheduleBackupRefusal,
  snapshotSettings,
} from "../../src/renderer/api/backups/backup-manifests";
import { keyOf } from "../../src/renderer/api/shared/navigation";
import { indexInventory, scheduleVerdict } from "../../src/renderer/api/shared/rows";
import {
  backups,
  clusterNamed,
  clusters,
  fixtureNow,
  scheduleNamed,
  variantOf,
} from "../support/fixtures";

const now = fixtureNow();

const backupNamed = (name: string) => {
  const found = backups().find((backup) => backup.getName() === name);
  if (!found) throw new Error(`no backup named ${name}`);
  return found;
};

describe("a backup taken now", () => {
  it("is what kubectl cnpg backup creates, through the cluster's plugin", () => {
    const manifest = backupManifest(clusterNamed("orders-db"), Date.parse("2026-10-03T21:50:07Z"));

    expect(manifest).toEqual({
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Backup",
      metadata: { name: "orders-db-20261003215007", namespace: "databases" },
      spec: {
        cluster: { name: "orders-db" },
        method: "plugin",
        pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" },
      },
    });
  });

  it("uses the in-tree method when that is configured, and nothing without one", () => {
    const inTree = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.backup = { barmanObjectStore: { destinationPath: "s3://x/" } };
    });

    expect(backupManifest(inTree, now)?.spec).toEqual({
      cluster: { name: "inventory-db" },
      method: "barmanObjectStore",
    });
    expect(backupManifest(clusterNamed("inventory-db"), now)).toBeUndefined();
  });
});

describe("backups from a schedule, from the backups page, and what a schedule takes with it", () => {
  it("starts what the schedule would, with its method and plugin, labelled as its run", () => {
    const manifest = scheduleBackupManifest(
      scheduleNamed("orders-hourly"),
      Date.parse("2026-10-03T21:50:07Z"),
    );

    expect(manifest).toEqual({
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Backup",
      metadata: {
        name: "orders-hourly-20261003215007",
        namespace: "databases",
        labels: { "cnpg.io/scheduled-backup": "orders-hourly" },
      },
      spec: {
        cluster: { name: "orders-db" },
        method: "plugin",
        pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" },
      },
    });
  });

  it("carries the schedule's target, online settings and plugin parameters", () => {
    const tuned = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.target = "primary";
      raw.spec.online = false;
      raw.spec.onlineConfiguration = { immediateCheckpoint: true, waitForArchive: false };
      raw.spec.pluginConfiguration.parameters = { barmanObjectName: "backups" };
    });

    expect(scheduleBackupManifest(tuned, now).spec).toEqual({
      cluster: { name: "orders-db" },
      method: "plugin",
      target: "primary",
      online: false,
      onlineConfiguration: { immediateCheckpoint: true, waitForArchive: false },
      pluginConfiguration: {
        name: "barman-cloud.cloudnative-pg.io",
        parameters: { barmanObjectName: "backups" },
      },
    });
  });

  it("is reported by the schedule once it fails", () => {
    const schedule = scheduleNamed("orders-hourly");
    const manifest = scheduleBackupManifest(schedule, now + 60_000);
    const started = variantOf(backupNamed("billing-nightly-20261012020000"), (raw) => {
      raw.metadata.name = manifest.metadata.name;
      raw.metadata.labels = manifest.metadata.labels;
      raw.spec = manifest.spec;
      raw.status.stoppedAt = new Date(now + 120_000).toISOString();
    });

    const index = indexInventory({ backups: [...backups(), started], schedules: [] });

    expect(scheduleVerdict(schedule, clusters(), index, now + 180_000)).toMatchObject({
      tone: "critical",
      label: "Last run failed",
    });
  });

  it("falls back to the operator's default method, with no plugin", () => {
    const plain = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.method = undefined;
      raw.spec.pluginConfiguration = undefined;
      raw.metadata.namespace = undefined;
    });

    expect(scheduleBackupManifest(plain, now)).toMatchObject({
      metadata: { namespace: "" },
      spec: { method: "barmanObjectStore" },
    });
    expect(scheduleBackupManifest(plain, now).spec.pluginConfiguration).toBeUndefined();
  });

  it("refuses a schedule whose cluster is missing or hibernated", () => {
    expect(scheduleBackupRefusal(scheduleNamed("orders-hourly"), clusters())).toBeUndefined();

    const orphan = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.cluster.name = "gone-db";
    });
    const asleep = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.cluster.name = "reports-db";
    });

    expect(scheduleBackupRefusal(orphan, clusters())).toContain("No cluster named gone-db");
    expect(scheduleBackupRefusal(asleep, clusters())).toContain("hibernated");
  });

  it("offers only clusters a backup can start for", () => {
    expect(
      backupCandidates(clusters())
        .map((cluster) => cluster.getName())
        .sort(),
    ).toEqual(["audit-db", "billing-db", "orders-db"]);
  });

  it("names the backups a schedule owns, which go with it", () => {
    const owned = ownedBackups(scheduleNamed("orders-hourly"), backups());

    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((backup) => backup.spec.cluster.name === "orders-db")).toBe(true);
    expect(ownedBackups(scheduleNamed("billing-nightly"), backups())).toEqual([]);
  });
});

describe("backup options", () => {
  it("offers the cluster's own method, and volume snapshots when declared", () => {
    expect(backupMethods(clusterNamed("orders-db"))).toEqual(["plugin"]);
    expect(backupMethods(clusterNamed("inventory-db"))).toEqual([]);

    const both = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.backup = { volumeSnapshot: { className: "csi" } };
    });
    const onlySnapshots = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.backup = { volumeSnapshot: { className: "csi" } };
    });

    expect(backupMethods(both)).toEqual(["plugin", "volumeSnapshot"]);
    expect(backupMethods(onlySnapshots)).toEqual(["volumeSnapshot"]);
  });

  it("takes the method and target asked for, and refuses a method the cluster lacks", () => {
    const both = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.backup = { volumeSnapshot: { className: "csi" } };
    });

    expect(
      backupManifest(both, now, { method: "volumeSnapshot", target: "primary" })?.spec,
    ).toEqual({
      cluster: { name: "orders-db" },
      method: "volumeSnapshot",
      target: "primary",
    });
    expect(
      backupManifest(clusterNamed("orders-db"), now, { target: "prefer-standby" })?.spec,
    ).toMatchObject({
      method: "plugin",
      pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" },
      target: "prefer-standby",
    });
    expect(
      backupManifest(clusterNamed("orders-db"), now, { method: "volumeSnapshot" }),
    ).toBeUndefined();
  });
});

describe("the Back up picker", () => {
  const withSnapshots = () =>
    variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.backup = { volumeSnapshot: { className: "csi" } };
    });
  const candidates = () =>
    backupCandidates([
      withSnapshots(),
      ...clusters().filter((cluster) => cluster.getName() !== "orders-db"),
    ]);

  it("backs up the picked cluster with every option its form set", () => {
    const picked = pickedBackup(
      candidates(),
      keyOf(clusterNamed("orders-db")),
      { method: "volumeSnapshot", online: false, target: "primary" },
      now,
    );

    expect(picked?.cluster.getName()).toBe("orders-db");
    expect(picked?.manifest.spec).toEqual({
      cluster: { name: "orders-db" },
      method: "volumeSnapshot",
      target: "primary",
      online: false,
    });
  });

  it("tells clusters apart by namespace and name", () => {
    const billing = pickedBackup(
      candidates(),
      keyOf(clusterNamed("billing-db")),
      { method: backupMethods(clusterNamed("billing-db"))[0] },
      now,
    );

    expect(billing?.manifest.spec.cluster).toEqual({ name: "billing-db" });
    expect(billing?.manifest.metadata.namespace).toBe(clusterNamed("billing-db").getNs());
    expect(pickedBackup(candidates(), "elsewhere/billing-db", {}, now)).toBeUndefined();
  });

  it("starts nothing for a method the picked cluster lacks", () => {
    expect(
      pickedBackup(
        candidates(),
        keyOf(clusterNamed("billing-db")),
        { method: "volumeSnapshot" },
        now,
      ),
    ).toBeUndefined();
  });
});

describe("volume snapshot settings", () => {
  const snapshots = () =>
    variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.backup = { volumeSnapshot: { className: "csi" } };
    });

  it("leaves them out unless asked, and for any other method", () => {
    expect(snapshotSettings({ method: "volumeSnapshot" })).toEqual({});
    expect(
      snapshotSettings({ method: "plugin", online: false, immediateCheckpoint: true }),
    ).toEqual({});
  });

  it("asks for a cold copy, which takes no online settings", () => {
    expect(
      snapshotSettings({ method: "volumeSnapshot", online: false, immediateCheckpoint: true }),
    ).toEqual({
      online: false,
    });
  });

  it("passes the checkpoint and archive settings of an online snapshot", () => {
    expect(
      snapshotSettings({
        method: "volumeSnapshot",
        immediateCheckpoint: true,
        waitForArchive: false,
      }),
    ).toEqual({ onlineConfiguration: { immediateCheckpoint: true, waitForArchive: false } });
    expect(snapshotSettings({ method: "volumeSnapshot", waitForArchive: true })).toEqual({});
  });

  it("puts them on the Backup it creates, only for a snapshot", () => {
    expect(
      backupManifest(snapshots(), now, { method: "volumeSnapshot", online: false })?.spec,
    ).toMatchObject({ method: "volumeSnapshot", online: false });
    expect(
      backupManifest(snapshots(), now, { method: "plugin", online: false })?.spec.online,
    ).toBeUndefined();
  });
});
