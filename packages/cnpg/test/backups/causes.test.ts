import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  archivingLogSource,
  backupLogSource,
  causeFromLog,
  causeSourceOf,
  failedBackupOf,
  logSourceKey,
  PLUGIN_CONTAINER,
  wantsCause,
} from "../../src/renderer/api/backups/causes";
import { indexInventory } from "../../src/renderer/api/shared/rows";
import { backups, clusterNamed, inventory, variantOf } from "../support/fixtures";

const backupNamed = (name: string) => {
  const found = backups().find((backup) => backup.getName() === name);
  if (!found) throw new Error(`no backup named ${name} in the fixtures`);
  return found;
};

const pluginLog = readFileSync(resolve(__dirname, "../fixtures/plugin-log.txt"), "utf8");

describe("the cause of a failed backup", () => {
  it("is barman's own error, not the operator's exit status", () => {
    const cause = causeFromLog(pluginLog);

    expect(cause).toMatch(
      /^Barman cloud WAL archive check exception: Permission denied when accessing bucket/,
    );
    expect(cause).not.toContain("exit status");
  });

  it("is the latest one when barman has said several things", () => {
    const lines = pluginLog.trim().split("\n");
    const last = lines.filter((line) => line.includes("ERROR:")).at(-1);
    const later = JSON.stringify({ msg: "2026-10-03 23:00:00,000 [1] ERROR: Something newer" });

    expect(last).toBeDefined();
    expect(causeFromLog([...lines, later].join("\n"))).toBe("Something newer");
  });

  it("finds none in a log without barman errors, or one that is not JSON", () => {
    const quiet = pluginLog
      .split("\n")
      .filter((line) => !line.includes("ERROR:"))
      .join("\n");

    expect(causeFromLog(quiet)).toBeUndefined();
    expect(causeFromLog("plain text\n{not json")).toBeUndefined();
    expect(causeFromLog(JSON.stringify({ msg: 42 }))).toBeUndefined();
  });
});

describe("where to read it", () => {
  it("is the primary's plugin sidecar for the plugin", () => {
    expect(archivingLogSource(clusterNamed("billing-db"))).toEqual({
      pod: "billing-db-1",
      container: PLUGIN_CONTAINER,
    });
  });

  it("is postgres itself for the in-tree object store", () => {
    const inTree = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.backup = { barmanObjectStore: { destinationPath: "s3://x/" } };
    });

    expect(archivingLogSource(inTree)).toEqual({ pod: "inventory-db-1", container: "postgres" });
  });

  it("is nowhere without archiving, or without a primary", () => {
    expect(archivingLogSource(clusterNamed("inventory-db"))).toBeUndefined();
    expect(archivingLogSource(clusterNamed("analytics-db"))).toBeUndefined();
  });
});

describe("where a failed backup's cause is", () => {
  it("is the instance that ran it, a standby here, not the primary", () => {
    const backup = backupNamed("billing-nightly-20261012020000");

    expect(clusterNamed("billing-db").status?.currentPrimary).toBe("billing-db-1");
    expect(backupLogSource(clusterNamed("billing-db"), backup)).toEqual({
      pod: "billing-db-2",
      container: PLUGIN_CONTAINER,
    });
  });

  it("falls back to the primary when the backup never named an instance", () => {
    const unplaced = variantOf(backupNamed("billing-nightly-20261012020000"), (raw) => {
      raw.status.instanceID = undefined;
    });

    expect(backupLogSource(clusterNamed("billing-db"), unplaced)?.pod).toBe("billing-db-1");

    const leaderless = variantOf(clusterNamed("billing-db"), (raw) => {
      raw.status.currentPrimary = undefined;
    });

    expect(backupLogSource(leaderless, unplaced)).toBeUndefined();
  });

  it("is postgres for the in-tree method, and nowhere for a volume snapshot", () => {
    const backup = backupNamed("billing-nightly-20261012020000");
    const inTree = variantOf(backup, (raw) => {
      raw.spec.method = "barmanObjectStore";
    });
    const snapshot = variantOf(backup, (raw) => {
      raw.spec.method = "volumeSnapshot";
    });
    const defaulted = variantOf(backup, (raw) => {
      raw.spec.method = undefined;
    });

    expect(backupLogSource(clusterNamed("billing-db"), inTree)?.container).toBe("postgres");
    expect(backupLogSource(clusterNamed("billing-db"), defaulted)?.container).toBe("postgres");
    expect(backupLogSource(clusterNamed("billing-db"), snapshot)).toBeUndefined();
  });

  it("is kept apart from the primary's archiving cause", () => {
    const cluster = clusterNamed("billing-db");
    const backup = backupNamed("billing-nightly-20261012020000");
    const archiving = archivingLogSource(cluster);
    const ran = backupLogSource(cluster, backup);

    if (!archiving || !ran) throw new Error("billing-db has no log to read");

    expect(logSourceKey(cluster.getNs(), ran)).not.toBe(logSourceKey(cluster.getNs(), archiving));
    expect(logSourceKey(cluster.getNs(), archiving)).toBe(
      `databases/billing-db-1/${PLUGIN_CONTAINER}`,
    );
  });
});

describe("the log behind a verdict", () => {
  const index = indexInventory(inventory());
  const failedOf = (kind: string, name: string, cluster: string) =>
    failedBackupOf({ kind, namespace: "databases", name, cluster }, index);

  it("is the standby that took a failed backup, on every list, not the primary", () => {
    const cluster = clusterNamed("billing-db");
    const failed = failedOf("Cluster", "billing-db", "billing-db");

    expect(failed?.getName()).toBe("billing-nightly-20261018020000");
    expect(causeSourceOf(cluster, "Last backup failed", failed)?.pod).toBe("billing-db-2");
  });

  it("is the instance of a schedule's last run", () => {
    const cluster = clusterNamed("billing-db");
    const failed = failedOf("ScheduledBackup", "billing-nightly", "billing-db");

    expect(failed?.status?.phase).toBe("failed");
    expect(causeSourceOf(cluster, "Last run failed", failed)?.pod).toBe("billing-db-2");
  });

  it("is the primary for archiving, and nowhere without a failed backup or a failure", () => {
    const cluster = clusterNamed("billing-db");
    const failed = failedOf("Cluster", "billing-db", "billing-db");

    expect(causeSourceOf(cluster, "Archiving failing", failed)?.pod).toBe("billing-db-1");
    expect(causeSourceOf(cluster, "Last backup failed", undefined)).toBeUndefined();
    expect(causeSourceOf(cluster, "Backed up", failed)).toBeUndefined();
    expect(failedOf("Cluster", "audit-db", "audit-db")).toBeUndefined();
  });
});

describe("when to look in the log", () => {
  it("only for failures whose reason the operator leaves out", () => {
    expect(wantsCause("Archiving failing")).toBe(true);
    expect(wantsCause("Last backup failed")).toBe(true);
    expect(wantsCause("Last run failed")).toBe(true);
    expect(wantsCause("No backup")).toBe(false);
    expect(wantsCause("Backed up")).toBe(false);
  });
});
