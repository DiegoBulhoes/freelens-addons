import { describe, expect, it } from "vitest";

import {
  attentionItems,
  clusterRows,
  countsOf,
  describeHeadline,
  lagIssues,
} from "../src/renderer/api/attention";
import {
  clusterNamed,
  fixtureNow,
  instanceStatus,
  inventory,
  publications,
  subscriptions,
  variantOf,
} from "./fixtures";

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
      clusters: 5,
      notReady: 1,
      backupsAtRisk: 4,
      noBackup: 3,
      hibernated: 1,
      poolersDown: 1,
    });
  });

  it("says how many of how many need attention", () => {
    expect(describeHeadline(0, 0)).toBe("No Postgres clusters found");
    expect(describeHeadline(0, 1)).toBe("All 1 Postgres cluster is ready and backed up");
    expect(describeHeadline(0, 3)).toBe("All 3 Postgres clusters are ready and backed up");
    expect(describeHeadline(2, 5)).toBe("2 of 5 Postgres clusters need attention");
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
});
