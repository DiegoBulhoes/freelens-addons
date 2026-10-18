import { describe, expect, it } from "vitest";

import { backupManifest } from "../../src/renderer/api/backups/backup-manifests";
import {
  clusterActionRefusal,
  clusterCommands,
  hibernationPatch,
  instanceRefusal,
  instanceRestart,
  instanceRestartRefusal,
  isNotFound,
  notAReplica,
  pausePatch,
  podReplaced,
  promotePatch,
  promoteRefusal,
  psqlCommand,
  psqlRefusal,
  reloadPatch,
  restartPatch,
  restartReplicasRefusal,
  suspendPatch,
  unlessNotFound,
} from "../../src/renderer/api/writes/operations";
import { clusterNamed, fixtureNow, pods, variantOf } from "../support/fixtures";

const now = fixtureNow();

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
      expect(clusterActionRefusal(clusterNamed("orders-db"), action)).toBeUndefined();
    }
  });

  it("refuses all but waking on a hibernated cluster", () => {
    expect(clusterActionRefusal(clusterNamed("reports-db"), "restart")).toContain("hibernated");
    expect(clusterActionRefusal(clusterNamed("reports-db"), "wake")).toBeUndefined();
    expect(clusterActionRefusal(clusterNamed("orders-db"), "wake")).toContain("not hibernated");
  });

  it("refuses a backup without a method", () => {
    expect(clusterActionRefusal(clusterNamed("inventory-db"), "backup")).toContain(
      "no backup method",
    );
  });

  it("refuses a switchover on an unhealthy cluster, or with no replica", () => {
    expect(clusterActionRefusal(clusterNamed("analytics-db"), "promote")).toContain(
      "Setting up primary",
    );
    expect(clusterActionRefusal(clusterNamed("inventory-db"), "promote")).toContain(
      "no healthy replica",
    );

    const unknown = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = undefined;
    });

    expect(clusterActionRefusal(unknown, "promote")).toContain('"unknown"');
  });
});

describe("commands to copy", () => {
  it("name the cluster and its namespace", () => {
    const commands = clusterCommands(clusterNamed("orders-db"));

    expect(commands.map((each) => each.label)).toContain("Status");
    expect(commands.every((each) => each.command.includes("orders-db"))).toBe(true);
    expect(commands[0]?.command).toBe("kubectl cnpg status orders-db -n databases");
  });

  it("find the operator by its label, wherever and however it was installed", () => {
    const log = clusterCommands(clusterNamed("orders-db")).find(
      (each) => each.label === "Operator log for this cluster",
    );

    expect(log?.command).toBe(
      `kubectl logs -n "$(kubectl get deploy -A -l app.kubernetes.io/name=cloudnative-pg -o jsonpath='{.items[0].metadata.namespace}')" -l app.kubernetes.io/name=cloudnative-pg --tail=-1 | grep '"cluster":"orders-db"'`,
    );
    expect(log?.command).not.toContain("cnpg-system");
  });

  it("fall back to the default namespace", () => {
    const bare = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.metadata.namespace = undefined;
    });

    expect(clusterCommands(bare)[0]?.command).toContain("-n default");
    expect(backupManifest(bare, now)?.metadata.namespace).toBe("");
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

  it("waits for a Ready pod that is not the one deleted, whatever the clocks say", () => {
    const deleted = replica().metadata.uid;
    // Created long ago by the local clock's reckoning: only the uid tells it is new.
    const recreated = variantOf(replica(), (raw) => {
      raw.metadata.uid = "00000000-0000-0000-0000-000000000001";
      raw.metadata.creationTimestamp = "2000-01-01T00:00:00Z";
    });

    expect(deleted).toBeDefined();
    expect(podReplaced(replica(), deleted)).toBe(false);
    expect(podReplaced(recreated, deleted)).toBe(true);
  });

  it("does not count a new pod that is not Ready yet, one without a uid, or none at all", () => {
    const starting = variantOf(replica(), (raw) => {
      raw.status.conditions = raw.status.conditions.map((condition: { type: string }) =>
        condition.type === "Ready" ? { ...condition, status: "False" } : condition,
      );
    });
    const unnamed = variantOf(replica(), (raw) => {
      raw.metadata.uid = undefined;
    });
    const unreported = variantOf(replica(), (raw) => {
      raw.status = undefined;
    });

    expect(podReplaced(starting, "gone")).toBe(false);
    expect(podReplaced(unnamed, "gone")).toBe(false);
    expect(podReplaced(unreported, "gone")).toBe(false);
    expect(podReplaced(undefined, "gone")).toBe(false);
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

// What the host's API client throws for a refused request: the Kubernetes Status it got back.
const statusError = (code: number, reason: string) => ({
  error: { kind: "Status", apiVersion: "v1", status: "Failure", code, reason },
  messages: [`pods "orders-db-1" is ${reason}`],
  toString: () => `pods "orders-db-1" is ${reason}`,
});

describe("destroying an instance step by step", () => {
  const podStep = unlessNotFound("delete the pod orders-db-1");

  it("goes on past an object already gone", () => {
    const gone = statusError(404, "NotFound");

    expect(isNotFound(gone)).toBe(true);
    expect(() => podStep(gone)).not.toThrow();
  });

  it("stops at any other error, naming the step, so the volumes are not deleted", () => {
    const forbidden = statusError(403, "Forbidden");
    const volumeStep = unlessNotFound("delete the volume orders-db-1");

    expect(isNotFound(forbidden)).toBe(false);
    expect(() => podStep(forbidden)).toThrow(
      /^Could not delete the pod orders-db-1, so nothing after it was deleted: .* is Forbidden$/,
    );
    expect(() => volumeStep(new Error("timeout"))).toThrow(
      /^Could not delete the volume orders-db-1, so nothing after it was deleted: timeout$/,
    );
    expect(isNotFound(undefined)).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe("a switchover, checked again just before writing", () => {
  it("goes ahead to a replica that is still healthy", () => {
    expect(promoteRefusal(clusterNamed("orders-db"), "orders-db-1")).toBeUndefined();
  });

  it("stops when a failover started meanwhile", () => {
    const failingOver = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = "Failing over";
      raw.status.targetPrimary = "orders-db-1";
    });

    expect(promoteRefusal(failingOver, "orders-db-1")).toContain('"Failing over"');
  });

  it("stops when the target became the primary or is no longer healthy", () => {
    const sick = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.instancesStatus.healthy = raw.status.instancesStatus.healthy.filter(
        (name: string) => name !== "orders-db-1",
      );
    });

    expect(promoteRefusal(clusterNamed("orders-db"), "orders-db-2")).toBe(
      "orders-db-2 is no longer a healthy replica.",
    );
    expect(promoteRefusal(sick, "orders-db-1")).toBe("orders-db-1 is no longer a healthy replica.");
  });
});

describe("restarting one instance, checked again just before writing", () => {
  it("goes ahead when nothing changed", () => {
    const seen = clusterNamed("orders-db");

    expect(instanceRestartRefusal(seen, clusterNamed("orders-db"), "orders-db-2")).toBeUndefined();
    expect(instanceRestartRefusal(seen, clusterNamed("orders-db"), "orders-db-1")).toBeUndefined();
  });

  it("does not overwrite the phase of a cluster that is failing over", () => {
    const failingOver = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = "Failing over";
    });

    expect(instanceRestartRefusal(clusterNamed("orders-db"), failingOver, "orders-db-2")).toContain(
      '"Failing over"',
    );
  });

  it("stops when the instance changed role since it was confirmed", () => {
    const switched = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.currentPrimary = "orders-db-1";
      raw.status.targetPrimary = "orders-db-1";
    });

    expect(instanceRestartRefusal(clusterNamed("orders-db"), switched, "orders-db-1")).toBe(
      "orders-db-1 became the primary.",
    );
    expect(instanceRestartRefusal(clusterNamed("orders-db"), switched, "orders-db-2")).toBe(
      "orders-db-2 is no longer the primary.",
    );
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
