import { describe, expect, it } from "vitest";

import {
  backupCandidates,
  backupFromSchedule,
  backupMethods,
  backupNow,
  clusterCommands,
  hibernationPatch,
  instanceRefusal,
  instanceRestart,
  notAReplica,
  ownedBackups,
  pausePatch,
  podBackAfter,
  promotePatch,
  psqlCommand,
  psqlRefusal,
  refusal,
  reloadPatch,
  restartPatch,
  restartReplicasRefusal,
  scheduleBackupRefusal,
  snapshotSettings,
  suspendPatch,
} from "../src/renderer/api/operations";
import {
  backups,
  clusterNamed,
  clusters,
  fixtureNow,
  pods,
  scheduleNamed,
  variantOf,
} from "./fixtures";

const now = fixtureNow();

describe("a backup taken now", () => {
  it("is what kubectl cnpg backup creates, through the cluster's plugin", () => {
    const manifest = backupNow(clusterNamed("orders-db"), Date.parse("2026-10-03T21:50:07Z"));

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

    expect(backupNow(inTree, now)?.spec).toEqual({
      cluster: { name: "inventory-db" },
      method: "barmanObjectStore",
    });
    expect(backupNow(clusterNamed("inventory-db"), now)).toBeUndefined();
  });
});

describe("the patches", () => {
  it("restart and reload stamp the operator's annotations", () => {
    const at = Date.parse("2026-10-03T21:50:07Z");

    expect(restartPatch(at)).toEqual({
      metadata: {
        annotations: { "kubectl.kubernetes.io/restartedAt": "2026-10-03T21:50:07.000Z" },
      },
    });
    expect(reloadPatch(at)).toEqual({
      metadata: { annotations: { "cnpg.io/reloadedAt": "2026-10-03T21:50:07.000Z" } },
    });
  });

  it("hibernate and wake set the annotation both ways", () => {
    expect(hibernationPatch(true)).toEqual({
      metadata: { annotations: { "cnpg.io/hibernation": "on" } },
    });
    expect(hibernationPatch(false)).toEqual({
      metadata: { annotations: { "cnpg.io/hibernation": "off" } },
    });
  });

  it("promote sets the target primary and the switchover phase", () => {
    expect(promotePatch("orders-db-3")).toEqual({
      status: {
        targetPrimary: "orders-db-3",
        phase: "Switchover in progress",
        phaseReason: "Switching over to orders-db-3",
      },
    });
  });
});

describe("what is refused, and why", () => {
  it("allows every action on a healthy cluster with replicas and a method", () => {
    for (const action of ["backup", "restart", "reload", "promote", "hibernate"] as const) {
      expect(refusal(clusterNamed("orders-db"), action)).toBeUndefined();
    }
  });

  it("refuses all but waking on a hibernated cluster", () => {
    expect(refusal(clusterNamed("reports-db"), "restart")).toContain("hibernated");
    expect(refusal(clusterNamed("reports-db"), "wake")).toBeUndefined();
    expect(refusal(clusterNamed("orders-db"), "wake")).toContain("not hibernated");
  });

  it("refuses a backup without a method", () => {
    expect(refusal(clusterNamed("inventory-db"), "backup")).toContain("no backup method");
  });

  it("refuses a switchover on an unhealthy cluster, or with no replica", () => {
    expect(refusal(clusterNamed("analytics-db"), "promote")).toContain("Setting up primary");
    expect(refusal(clusterNamed("inventory-db"), "promote")).toContain("no healthy replica");

    const unknown = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = undefined;
    });

    expect(refusal(unknown, "promote")).toContain('"unknown"');
  });
});

describe("commands to copy", () => {
  it("name the cluster and its namespace", () => {
    const commands = clusterCommands(clusterNamed("orders-db"));

    expect(commands.map((each) => each.label)).toContain("Status");
    expect(commands.every((each) => each.command.includes("orders-db"))).toBe(true);
    expect(commands[0]?.command).toBe("kubectl cnpg status orders-db -n databases");
  });

  it("fall back to the default namespace", () => {
    const bare = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.metadata.namespace = undefined;
    });

    expect(clusterCommands(bare)[0]?.command).toContain("-n default");
    expect(backupNow(bare, now)?.metadata.namespace).toBe("");
  });
});

describe("schedules, poolers and psql", () => {
  it("suspend and start a schedule, pause and start a pooler", () => {
    expect(suspendPatch(true)).toEqual({ spec: { suspend: true } });
    expect(suspendPatch(false)).toEqual({ spec: { suspend: false } });
    expect(pausePatch(true)).toEqual({ spec: { pgbouncer: { paused: true } } });
    expect(pausePatch(false)).toEqual({ spec: { pgbouncer: { paused: false } } });
  });

  it("runs psql in the instance's postgres container, as kubectl cnpg psql does", () => {
    expect(psqlCommand(clusterNamed("orders-db"), "orders-db-2")).toBe(
      "kubectl exec -it -n databases orders-db-2 -c postgres -- psql",
    );
  });

  it("connects to a healthy instance, and says why not otherwise", () => {
    expect(psqlRefusal(clusterNamed("orders-db"), "orders-db-2")).toBeUndefined();
    expect(psqlRefusal(clusterNamed("reports-db"), "reports-db-1")).toContain("hibernated");
    expect(psqlRefusal(clusterNamed("analytics-db"), undefined)).toContain("no primary yet");
    expect(psqlRefusal(clusterNamed("orders-db"), "orders-db-9")).toContain("not healthy");

    const unreported = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.instancesStatus = undefined;
    });

    expect(psqlRefusal(unreported, "orders-db-2")).toContain("not healthy");
  });
});

describe("restarting every replica", () => {
  it("is allowed on a healthy cluster with replicas", () => {
    expect(restartReplicasRefusal(clusterNamed("orders-db"))).toBeUndefined();
  });

  it("is refused hibernated, unhealthy, or without a replica", () => {
    expect(restartReplicasRefusal(clusterNamed("reports-db"))).toContain("hibernated");
    expect(restartReplicasRefusal(clusterNamed("analytics-db"))).toContain("Setting up primary");
    expect(restartReplicasRefusal(clusterNamed("inventory-db"))).toContain("no replica");

    const unknown = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = undefined;
    });

    expect(restartReplicasRefusal(unknown)).toContain('"unknown"');
  });

  const replica = () => {
    const found = pods().find((pod) => pod.getName() === "orders-db-1");
    if (!found) throw new Error("no orders-db-1 pod in the fixtures");
    return found;
  };

  it("waits for a pod created after the deletion, and Ready", () => {
    const created = Date.parse(replica().metadata.creationTimestamp ?? "");

    expect(podBackAfter(replica(), created - 1000)).toBe(true);
    expect(podBackAfter(replica(), created + 1000)).toBe(false);
  });

  it("does not count a new pod that is not Ready yet, or none at all", () => {
    const starting = variantOf(replica(), (raw) => {
      raw.status.conditions = raw.status.conditions.map((condition: { type: string }) =>
        condition.type === "Ready" ? { ...condition, status: "False" } : condition,
      );
    });
    const undated = variantOf(replica(), (raw) => {
      raw.metadata.creationTimestamp = undefined;
    });
    const unreported = variantOf(replica(), (raw) => {
      raw.status = undefined;
    });

    expect(podBackAfter(starting, 0)).toBe(false);
    expect(podBackAfter(undated, 0)).toBe(false);
    expect(podBackAfter(unreported, 0)).toBe(false);
    expect(podBackAfter(undefined, 0)).toBe(false);
  });
});

describe("backups from a schedule, from the backups page, and what a schedule takes with it", () => {
  it("starts what the schedule would, with its method and plugin", () => {
    const manifest = backupFromSchedule(
      scheduleNamed("orders-hourly"),
      Date.parse("2026-10-03T21:50:07Z"),
    );

    expect(manifest).toEqual({
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Backup",
      metadata: { name: "orders-hourly-20261003215007", namespace: "databases" },
      spec: {
        cluster: { name: "orders-db" },
        method: "plugin",
        pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" },
      },
    });
  });

  it("falls back to the operator's default method, with no plugin", () => {
    const plain = variantOf(scheduleNamed("orders-hourly"), (raw) => {
      raw.spec.method = undefined;
      raw.spec.pluginConfiguration = undefined;
      raw.metadata.namespace = undefined;
    });

    expect(backupFromSchedule(plain, now)).toMatchObject({
      metadata: { namespace: "" },
      spec: { method: "barmanObjectStore" },
    });
    expect(backupFromSchedule(plain, now).spec.pluginConfiguration).toBeUndefined();
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
    ).toEqual(["billing-db", "orders-db"]);
  });

  it("names the backups a schedule owns, which go with it", () => {
    const owned = ownedBackups(scheduleNamed("orders-hourly"), backups());

    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((backup) => backup.spec.cluster.name === "orders-db")).toBe(true);
    expect(ownedBackups(scheduleNamed("billing-nightly"), backups())).toEqual([]);
  });
});

describe("one instance at a time", () => {
  it("restarts the primary in place and a replica by deleting its pod", () => {
    expect(instanceRestart(clusterNamed("orders-db"), "orders-db-2")).toEqual({
      kind: "in-place",
      patch: {
        status: {
          phase: "Primary instance is being restarted in-place",
          phaseReason: "Requested by the user",
        },
      },
    });
    expect(instanceRestart(clusterNamed("orders-db"), "orders-db-1")).toEqual({
      kind: "delete-pod",
      pod: "orders-db-1",
    });
  });

  it("refuses to destroy the primary, or the only instance", () => {
    expect(instanceRefusal(clusterNamed("orders-db"), "orders-db-1", "destroy")).toBeUndefined();
    expect(instanceRefusal(clusterNamed("orders-db"), "orders-db-2", "destroy")).toContain(
      "is the primary",
    );
    expect(instanceRefusal(clusterNamed("inventory-db"), "inventory-db-2", "destroy")).toContain(
      "single instance",
    );
  });

  it("refuses either on a hibernated or unhealthy cluster, but restarts the primary of a healthy one", () => {
    expect(instanceRefusal(clusterNamed("reports-db"), "reports-db-1", "restart")).toContain(
      "hibernated",
    );
    expect(instanceRefusal(clusterNamed("analytics-db"), "analytics-db-1", "restart")).toContain(
      "Wait until",
    );
    expect(instanceRefusal(clusterNamed("orders-db"), "orders-db-2", "restart")).toBeUndefined();

    const unknown = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = undefined;
    });

    expect(instanceRefusal(unknown, "orders-db-1", "restart")).toContain('"unknown"');
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

    expect(backupNow(both, now, { method: "volumeSnapshot", target: "primary" })?.spec).toEqual({
      cluster: { name: "orders-db" },
      method: "volumeSnapshot",
      target: "primary",
    });
    expect(
      backupNow(clusterNamed("orders-db"), now, { target: "prefer-standby" })?.spec,
    ).toMatchObject({
      method: "plugin",
      pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" },
      target: "prefer-standby",
    });
    expect(backupNow(clusterNamed("orders-db"), now, { method: "volumeSnapshot" })).toBeUndefined();
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
      backupNow(snapshots(), now, { method: "volumeSnapshot", online: false })?.spec,
    ).toMatchObject({ method: "volumeSnapshot", online: false });
    expect(
      backupNow(snapshots(), now, { method: "plugin", online: false })?.spec.online,
    ).toBeUndefined();
  });
});

describe("checking an instance is still a replica, just before writing", () => {
  it("lets a replica through, and stops at the primary or one being promoted", () => {
    expect(notAReplica(clusterNamed("orders-db"), "orders-db-1")).toBeUndefined();
    expect(notAReplica(clusterNamed("orders-db"), "orders-db-2")).toBe(
      "orders-db-2 is the primary now.",
    );

    const promoting = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.targetPrimary = "orders-db-3";
    });

    expect(notAReplica(promoting, "orders-db-3")).toBe("orders-db-3 is being promoted.");
  });
});
