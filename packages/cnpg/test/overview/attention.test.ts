import { describe, expect, it } from "vitest";

import {
  attentionItems,
  attentionKey,
  clusterRows,
  clustersNeeding,
  countsOf,
  describeHeadline,
  lagIssues,
} from "../../src/renderer/api/overview/attention";
import { indexInventory } from "../../src/renderer/api/shared/rows";
import {
  clusterNamed,
  fixtureNow,
  instanceStatus,
  inventory,
  pods,
  publications,
  subscriptions,
  variantOf,
} from "../support/fixtures";

const now = fixtureNow();

describe("the clusters list", () => {
  it("puts the worst first and the healthy last", () => {
    const rows = clusterRows(inventory(), now);

    expect(rows.at(-1)?.cluster.getName()).toBe("orders-db");
    expect(
      rows
        .slice(0, 3)
        .map((row) => row.cluster.getName())
        .sort(),
    ).toEqual(["analytics-db", "billing-db", "inventory-db"]);
  });

  it("carries the last backup and the recovery window", () => {
    const orders = clusterRows(inventory(), now).find(
      (row) => row.cluster.getName() === "orders-db",
    );

    expect(orders?.lastBackup).toBeDefined();
    expect(orders?.recoverableFrom).toBeDefined();
  });
});

describe("what needs attention", () => {
  const items = attentionItems(inventory(), now);

  it("lists each broken thing once, critical first", () => {
    expect(items.map((item) => `${item.kind}/${item.name}`)).toEqual(
      expect.arrayContaining([
        "Cluster/analytics-db",
        "Cluster/billing-db",
        "Cluster/inventory-db",
        "Pooler/legacy-rw",
        "ScheduledBackup/billing-nightly",
      ]),
    );
    expect(items.every((item) => item.verdict.tone !== "ok")).toBe(true);
    expect(items[0]?.verdict.tone).toBe("critical");
  });

  it("names the backup problem of a hibernated cluster, not the hibernation", () => {
    const reports = items.find((item) => item.name === "reports-db");

    expect(reports?.verdict.label).toBe("No backup");
  });

  it("adds a healthy cluster whose certificate expired, beside its other problems", () => {
    const expired = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.certificates.expirations["orders-db-server"] = "2020-01-01 00:00:00 +0000 UTC";
    });
    const withExpired = {
      ...inventory(),
      clusters: [...inventory().clusters.filter((c) => c.getName() !== "orders-db"), expired],
    };
    const found = attentionItems(withExpired, now).filter(
      (item) => item.name === "orders-db" && item.verdict.label === "Certificate expired",
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.verdict.reason).toContain("orders-db-server");
  });

  it("leaves out a healthy, backed-up cluster with nothing else wrong", () => {
    const fine = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.managedRolesStatus.cannotReconcile = undefined;
      raw.status.managedRolesStatus.byStatus["pending-reconciliation"] = [];
    });
    const clean = {
      ...inventory(),
      clusters: [...inventory().clusters.filter((c) => c.getName() !== "orders-db"), fine],
    };

    expect(
      items.filter((item) => item.name === "orders-db").map((item) => item.verdict.label),
    ).toEqual(["Role not applied"]);
    expect(attentionItems(clean, now).some((item) => item.name === "orders-db")).toBe(false);
  });
});

describe("the overview's counts and headline", () => {
  it("counts what each card opens", () => {
    expect(countsOf(inventory(), now)).toEqual({
      clusters: 7,
      notReady: 1,
      backupsAtRisk: 4,
      noBackup: 3,
      hibernated: 1,
      poolersDown: 1,
    });
  });

  it("counts a pooler with no ready pod as down, once its pods are read", () => {
    const crashing = pods().map((pod) =>
      pod.metadata.labels?.["cnpg.io/poolerName"] === "orders-ro"
        ? variantOf(pod, (raw) => {
            for (const condition of raw.status.conditions) {
              if (condition.type === "Ready") condition.status = "False";
            }
          })
        : pod,
    );
    const withPods = { ...inventory(), pods: crashing };

    expect(countsOf({ ...inventory(), pods: pods() }, now).poolersDown).toBe(1);
    expect(countsOf(withPods, now).poolersDown).toBe(2);
    expect(attentionItems(withPods, now)).toContainEqual(
      expect.objectContaining({
        kind: "Pooler",
        name: "orders-ro",
        verdict: expect.objectContaining({ label: "No ready pod" }),
      }),
    );
  });

  it("works from the rows it is given, so the overview builds them once", () => {
    const index = indexInventory(inventory());

    expect(countsOf(inventory(), now, []).clusters).toBe(0);
    const fromNoRows = attentionItems(inventory(), now, index, []);

    expect(fromNoRows.some((item) => item.kind === "Cluster")).toBe(false);
    expect(attentionItems(inventory(), now, index)).toEqual(attentionItems(inventory(), now));
  });

  it("counts two clusters of one name in two namespaces as two", () => {
    const twin = variantOf(clusterNamed("billing-db"), (raw) => {
      raw.metadata.namespace = "staging";
    });
    const items = attentionItems(
      { ...inventory(), clusters: [...inventory().clusters, twin] },
      now,
    );

    expect(clustersNeeding(items)).toBe(clustersNeeding(attentionItems(inventory(), now)) + 1);
  });

  it("says how many of how many need attention", () => {
    expect(describeHeadline(0, 0, "ready")).toBe("No Postgres clusters found");
    expect(describeHeadline(0, 1, "ready")).toBe("All 1 Postgres cluster is ready and backed up");
    expect(describeHeadline(0, 3, "ready")).toBe("All 3 Postgres clusters are ready and backed up");
    expect(describeHeadline(2, 5, "ready")).toBe("2 of 5 Postgres clusters need attention");
  });

  it("says none only once the clusters are read", () => {
    expect(describeHeadline(0, 0, "connecting")).toBe("Postgres clusters");
    expect(describeHeadline(0, 0, "unreachable")).toBe("Postgres clusters");
  });
});

describe("what the attention list adds from roles, logical replication and lag", () => {
  const withEverything = () => ({
    ...inventory(),
    publications: publications(),
    subscriptions: subscriptions(),
    statuses: Object.fromEntries(
      ["orders-db-1", "orders-db-2", "orders-db-3"].map((pod) => [
        `databases/${pod}`,
        instanceStatus(pod),
      ]),
    ),
  });

  it("names the role that cannot be created, the broken publication and subscription, and the paused replica", () => {
    const labels = attentionItems(withEverything(), now).map(
      (item) => `${item.kind}/${item.name}: ${item.verdict.label}`,
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        "Cluster/orders-db: Role not applied",
        "Cluster/orders-db: Replay paused",
        "Publication/legacy-pub: Not applied",
        "Subscription/billing-sub: Not applied",
      ]),
    );
    expect(labels.some((label) => label.startsWith("Publication/orders-pub"))).toBe(false);
  });

  it("says which replica lags", () => {
    expect(lagIssues(clusterNamed("orders-db"), withEverything().statuses)).toEqual([
      expect.objectContaining({
        label: "Replay paused",
        reason: expect.stringMatching(/^orders-db-3: /),
      }),
    ]);
    expect(lagIssues(clusterNamed("orders-db"), undefined)).toEqual([]);
  });

  it("says which replica the primary has lost", () => {
    const primary = instanceStatus("orders-db-2");
    const statuses = {
      ...withEverything().statuses,
      "databases/orders-db-2": {
        ...primary,
        replicationInfo: (primary.replicationInfo ?? []).filter(
          (info) => info.applicationName !== "orders-db-1",
        ),
      },
    };

    expect(lagIssues(clusterNamed("orders-db"), statuses)).toContainEqual(
      expect.objectContaining({
        tone: "critical",
        label: "Not streaming",
        reason: "orders-db-1: It is not connected to the primary.",
      }),
    );
  });

  it("keys each row apart, even two replicas lost under one label", () => {
    const primary = instanceStatus("orders-db-2");
    const statuses = {
      ...withEverything().statuses,
      "databases/orders-db-2": { ...primary, replicationInfo: [] },
    };
    const items = attentionItems({ ...withEverything(), statuses }, now);
    const lost = items.filter((item) => item.verdict.label === "Not streaming");

    expect(lost).toHaveLength(2);
    expect(new Set(items.map(attentionKey)).size).toBe(items.length);
  });
});
