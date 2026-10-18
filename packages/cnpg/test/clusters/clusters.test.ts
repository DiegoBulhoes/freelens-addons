import { describe, expect, it } from "vitest";

import {
  clusterHealth,
  healthyReplicaNames,
  instancesOf,
  isHibernated,
  isReplicaCluster,
  lastSwitchover,
  postgresVersion,
  primaryRole,
  type Role,
  readyCount,
  replicaNames,
  replicaSourceOf,
  roleLabel,
} from "../../src/renderer/api/clusters/clusters";
import { clusterNamed, variantOf } from "../support/fixtures";

describe("a cluster's health", () => {
  it("is healthy with every instance ready", () => {
    const health = clusterHealth(clusterNamed("orders-db"));

    expect(health).toMatchObject({ tone: "ok", label: "Healthy" });
    expect(health.reason).toContain("orders-db-2");
  });

  it("is not ready while the primary is still being set up", () => {
    const health = clusterHealth(clusterNamed("analytics-db"));

    expect(health).toMatchObject({ tone: "critical", label: "Not ready" });
    expect(health.reason).toContain("Creating primary instance analytics-db-1");
  });

  it("is hibernated although its phase still reads healthy", () => {
    const reports = clusterNamed("reports-db");

    expect(reports.status?.phase).toBe("Cluster in healthy state");
    expect(isHibernated(reports)).toBe(true);
    expect(clusterHealth(reports)).toMatchObject({ tone: "info", label: "Hibernated" });
  });

  it("is hibernated by the annotation alone, before the operator reports it", () => {
    const asked = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.metadata.annotations = { "cnpg.io/hibernation": "on" };
    });

    expect(isHibernated(asked)).toBe(true);
    expect(isHibernated(clusterNamed("inventory-db"))).toBe(false);
  });

  it("shows a phase other than healthy, such as a switchover in progress", () => {
    const switching = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = "Switchover in progress";
      raw.status.phaseReason = "Switching over to orders-db-3";
    });

    expect(clusterHealth(switching)).toMatchObject({
      tone: "warning",
      label: "Switchover in progress",
      reason: "Switching over to orders-db-3",
    });
  });

  it("falls back to the phase when the operator gives no reason", () => {
    const quiet = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.phase = "Upgrading cluster";
      raw.status.phaseReason = undefined;
    });

    expect(clusterHealth(quiet).reason).toBe("Upgrading cluster");
  });

  it("counts one instance in the singular", () => {
    expect(clusterHealth(clusterNamed("inventory-db")).reason).toBe(
      "1 instance ready, primary inventory-db-1.",
    );
  });

  it("is degraded when fewer instances are ready than asked for", () => {
    const short = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.readyInstances = 2;
    });

    expect(readyCount(short)).toEqual({ ready: 2, wanted: 3 });
    expect(clusterHealth(short)).toMatchObject({ tone: "warning", label: "Degraded" });
    expect(clusterHealth(short).reason).toBe("2 of 3 instances are ready.");
  });
});

describe("a cluster's instances", () => {
  it("names the primary after a switchover, and the replicas", () => {
    const instances = instancesOf(clusterNamed("orders-db"));

    expect(instances.find((each) => each.role === "primary")?.name).toBe("orders-db-2");
    expect(healthyReplicaNames(clusterNamed("orders-db"))).toEqual(["orders-db-1", "orders-db-3"]);
    expect(instances.every((each) => each.healthy)).toBe(true);
  });

  it("lists the primary first, then the replicas by name", () => {
    expect(instancesOf(clusterNamed("orders-db")).map((each) => [each.name, each.role])).toEqual([
      ["orders-db-2", "primary"],
      ["orders-db-1", "replica"],
      ["orders-db-3", "replica"],
    ]);
    expect(replicaNames(clusterNamed("orders-db"))).toEqual(["orders-db-1", "orders-db-3"]);
  });

  it("counts an unhealthy replica among the replicas, but not one being promoted", () => {
    const shaky = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.instancesStatus.healthy = ["orders-db-2", "orders-db-3"];
      raw.status.targetPrimary = "orders-db-3";
    });

    expect(replicaNames(shaky)).toEqual(["orders-db-1"]);
    expect(healthyReplicaNames(shaky)).toEqual([]);
    expect(instancesOf(shaky).map((each) => each.role)).toEqual([
      "primary",
      "promoting",
      "replica",
    ]);
  });

  it("lists none for a hibernated cluster, although the operator keeps their names", () => {
    const reports = clusterNamed("reports-db");

    expect(reports.status?.instanceNames).toEqual(["reports-db-1"]);
    expect(instancesOf(reports)).toEqual([]);
  });

  it("marks the instance being promoted, and has no replica to promote with one instance", () => {
    const promoting = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.targetPrimary = "orders-db-3";
    });

    expect(instancesOf(promoting).find((each) => each.name === "orders-db-3")?.role).toBe(
      "promoting",
    );
    expect(healthyReplicaNames(clusterNamed("inventory-db"))).toEqual([]);
  });

  it("dates the last switchover only once the timeline has moved", () => {
    expect(lastSwitchover(clusterNamed("orders-db"))).toBe(
      clusterNamed("orders-db").status?.currentPrimaryTimestamp,
    );
    expect(lastSwitchover(clusterNamed("billing-db"))).toBeUndefined();
  });

  it("has no instances to list before the operator reports any", () => {
    const empty = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status = undefined;
    });

    expect(instancesOf(empty)).toEqual([]);
    expect(lastSwitchover(empty)).toBeUndefined();
    expect(clusterHealth(empty)).toMatchObject({
      tone: "critical",
      label: "Not ready",
      reason: "Unknown",
    });
  });
});

describe("an instance's role label", () => {
  it("calls a replica cluster's primary the designated primary, as the rest of its drawer does", () => {
    const replica = clusterNamed("orders-replica-db");
    const [first] = instancesOf(replica);

    expect(first && roleLabel(replica, first.role)).toBe("Designated primary");
  });

  it("names each role of an ordinary cluster", () => {
    const orders = clusterNamed("orders-db");

    expect(
      ["primary", "promoting", "replica"].map((role) => roleLabel(orders, role as Role)),
    ).toEqual(["Primary", "Promoting", "Replica"]);
  });
});

describe("the Postgres version", () => {
  it("is the image tag's version", () => {
    expect(postgresVersion(clusterNamed("orders-db"))).toBe("18.4");
  });

  it("reads a pinned or plain tag, and falls back to the data's major version", () => {
    const pinned = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.image = "ghcr.io/cloudnative-pg/postgresql:17.6@sha256:abc";
    });
    const plain = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.image = "registry.example.test/postgres:16";
    });
    const untagged = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.image = "registry.example.test/postgres";
    });
    const unknown = variantOf(untagged, (raw) => {
      raw.status.pgDataImageInfo = undefined;
    });

    expect(postgresVersion(pinned)).toBe("17.6");
    expect(postgresVersion(plain)).toBe("16");
    expect(postgresVersion(untagged)).toBe("18");
    expect(postgresVersion(unknown)).toBeUndefined();
  });
});

describe("a replica cluster", () => {
  const withReplica = (replica: object) =>
    variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.replica = replica;
    });

  it("is one when enabled, whatever the primary field says", () => {
    expect(isReplicaCluster(withReplica({ enabled: true, source: "orders" }))).toBe(true);
    expect(
      isReplicaCluster(withReplica({ enabled: false, source: "orders", primary: "orders" })),
    ).toBe(false);
  });

  it("is one in a distributed topology unless it is the named primary", () => {
    expect(isReplicaCluster(withReplica({ source: "orders", primary: "orders" }))).toBe(true);
    expect(isReplicaCluster(withReplica({ source: "orders", primary: "inventory-db" }))).toBe(
      false,
    );
    expect(isReplicaCluster(withReplica({ source: "orders", primary: "east", self: "east" }))).toBe(
      false,
    );
  });

  it("is not one without the replica stanza", () => {
    expect(isReplicaCluster(clusterNamed("inventory-db"))).toBe(false);
  });
  it("names the seeded replica's designated primary and the cluster it replays", () => {
    const replica = clusterNamed("orders-replica-db");

    expect(clusterHealth(replica)).toEqual({
      tone: "ok",
      label: "Healthy",
      reason: "1 instance ready, designated primary orders-replica-db-1, replaying orders-db.",
    });
    expect(primaryRole(replica)).toBe("Designated primary");
    expect(replicaSourceOf(replica)).toEqual({
      name: "orders-db",
      host: "orders-db-rw.databases.svc",
    });
  });

  it("gives a primary cluster no source, and leaves out a host it does not declare", () => {
    const undeclared = variantOf(clusterNamed("orders-replica-db"), (raw) => {
      raw.spec.replica.source = "elsewhere";
    });

    expect(primaryRole(clusterNamed("orders-db"))).toBe("Primary");
    expect(replicaSourceOf(clusterNamed("orders-db"))).toBeUndefined();
    expect(replicaSourceOf(undeclared)).toEqual({ name: "elsewhere", host: undefined });
  });
});
