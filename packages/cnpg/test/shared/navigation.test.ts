import { describe, expect, it } from "vitest";
import {
  attentionItems,
  cardsOf,
  clusterRows,
  countsOf,
  destinationOf,
} from "../../src/renderer/api/overview/attention";
import { logicalRows } from "../../src/renderer/api/replication/logical";
import { bulkEffect, CLUSTER_EFFECTS } from "../../src/renderer/api/shared/effects";
import { hostListOf } from "../../src/renderer/api/shared/host-links";
import {
  CLUSTER_FILTERS,
  clusterKeyOf,
  isClusterFilter,
  isPoolerFilter,
  matchesClusterFilter,
  matchesPoolerFilter,
  namedKey,
  opensTitle,
} from "../../src/renderer/api/shared/navigation";
import { indexInventory, poolerVerdict } from "../../src/renderer/api/shared/rows";
import {
  backupSearchTexts,
  clusterSearchTexts,
  logicalSearchTexts,
  poolerSearchTexts,
  scheduleSearchTexts,
} from "../../src/renderer/api/shared/search";
import { searchRows } from "../../src/renderer/api/shared/table";
import { until } from "../../src/renderer/api/shared/verdict";
import {
  backups,
  clusterNamed,
  fixtureNow,
  inventory,
  pods,
  poolerNamed,
  poolers,
  publications,
  schedules,
  subscriptions,
  variantOf,
} from "../support/fixtures";

const now = fixtureNow();
const full = () => ({
  ...inventory(),
  pods: pods(),
  publications: publications(),
  subscriptions: subscriptions(),
});

describe("an overview card", () => {
  const stores = full();
  const rows = clusterRows(stores, now);
  const cards = cardsOf(countsOf(stores, now, rows), "ready");

  it("is not drawn before the lists are read, rather than reading zero", () => {
    for (const state of ["connecting", "unreachable", "not-installed"] as const) {
      expect(cardsOf(countsOf(stores, now, rows), state), state).toEqual([]);
    }
  });

  it("counts exactly the rows the list filter it opens keeps", () => {
    for (const card of cards) {
      const [page, params] = card.opens;
      const filter = params?.filter;
      const kept =
        page === "clusters"
          ? rows.filter((row) =>
              matchesClusterFilter(row, isClusterFilter(filter) ? filter : undefined),
            )
          : stores.poolers.filter((pooler) =>
              matchesPoolerFilter(
                poolerVerdict(pooler, stores.clusters, stores.pods),
                isPoolerFilter(filter) ? filter : undefined,
              ),
            );

      expect(kept.length, card.label).toBe(card.value);
    }
  });

  it("keeps, under each filter, the seeded clusters in that state", () => {
    const kept = (filter: (typeof CLUSTER_FILTERS)[number]) =>
      rows
        .filter((row) => matchesClusterFilter(row, filter))
        .map((row) => row.cluster.getName())
        .sort();

    expect(Object.fromEntries(CLUSTER_FILTERS.map((filter) => [filter, kept(filter)]))).toEqual({
      "not-ready": ["analytics-db"],
      "at-risk": ["analytics-db", "billing-db", "inventory-db", "reports-db"],
      "no-backup": ["analytics-db", "inventory-db", "reports-db"],
      hibernated: ["reports-db"],
    });
    expect(
      stores.poolers
        .filter((pooler) =>
          matchesPoolerFilter(poolerVerdict(pooler, stores.clusters, stores.pods), "down"),
        )
        .map((pooler) => pooler.getName()),
    ).toEqual(["legacy-rw"]);
  });

  it("opens each cluster card on its own filter, and pooler down on the poolers", () => {
    expect(cards.map((card) => card.opens)).toEqual([
      ["clusters"],
      ["clusters", { filter: "not-ready" }],
      ["clusters", { filter: "at-risk" }],
      ["clusters", { filter: "no-backup" }],
      ["clusters", { filter: "hibernated" }],
      ["poolers", { filter: "down" }],
    ]);
    expect(cards.map((card) => card.title)).toContain(
      "Opens the clusters with no backup method and no completed backup",
    );
  });

  it("keeps 'No backup yet' out of 'No backup', as a text search did not", () => {
    const noBackup = rows
      .filter((row) => matchesClusterFilter(row, "no-backup"))
      .map((row) => row.cluster.getName());
    const searched = searchRows(rows, "no backup", (row) => [row.backup.label]).map((row) =>
      row.cluster.getName(),
    );

    expect(searched).toContain("audit-db");
    expect(noBackup).not.toContain("audit-db");
    expect(noBackup).toEqual(
      rows.filter((row) => row.backup.label === "No backup").map((row) => row.cluster.getName()),
    );
  });

  it("opens 'Cannot be restored safely' on the clusters it counts, not on every one", () => {
    const atRisk = rows.filter((row) => matchesClusterFilter(row, "at-risk"));

    expect(atRisk.length).toBeGreaterThan(0);
    expect(atRisk.length).toBeLessThan(rows.length);
    expect(atRisk.every((row) => row.backup.tone === "critical")).toBe(true);
  });

  it("does not count a replica cluster with no method of its own as having no backup", () => {
    const replica = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.replica = { enabled: true, source: "orders" };
    });
    const withReplica = {
      ...stores,
      clusters: [...stores.clusters.filter((each) => each.getName() !== "inventory-db"), replica],
    };

    expect(countsOf(withReplica, now).noBackup).toBe(countsOf(stores, now).noBackup - 1);
  });
});

describe("the list filters", () => {
  it("knows its own filter names only", () => {
    expect(CLUSTER_FILTERS.every(isClusterFilter)).toBe(true);
    expect(isClusterFilter("no backup")).toBe(false);
    expect(isClusterFilter(undefined)).toBe(false);
    expect(isPoolerFilter("down")).toBe(true);
    expect(isPoolerFilter("")).toBe(false);
  });

  it("keeps every row without a filter", () => {
    const rows = clusterRows(inventory(), now);
    const stores = full();
    const active = poolerVerdict(poolerNamed("orders-rw"), stores.clusters, stores.pods);
    const down = poolerVerdict(poolerNamed("legacy-rw"), stores.clusters, stores.pods);

    expect(rows.every((row) => matchesClusterFilter(row, undefined))).toBe(true);
    expect(matchesPoolerFilter(active, undefined)).toBe(true);
    expect(matchesPoolerFilter(active, "down")).toBe(false);
    expect(matchesPoolerFilter(down, "down")).toBe(true);
  });

  it("turns a chip's title into a card's", () => {
    expect(opensTitle("Shows the hibernated clusters")).toBe("Opens the hibernated clusters");
  });
});

describe("an attention row", () => {
  const items = attentionItems(full(), now);
  const first = (kind: string) => {
    const found = items.find((item) => item.kind === kind);

    if (!found) throw new Error(`no ${kind} needs attention in the fixtures`);

    return found;
  };

  it("opens its own object's drawer by namespace and name", () => {
    expect(destinationOf(first("Cluster")).opens).toEqual([
      "clusters",
      { namespace: "databases", name: first("Cluster").name },
    ]);
    expect(destinationOf(first("Pooler"))).toEqual({
      title: "Opens the pooler",
      opens: ["poolers", { namespace: "databases", name: first("Pooler").name }],
    });
    expect(destinationOf(first("ScheduledBackup"))).toEqual({
      title: "Opens the schedule",
      opens: ["schedules", { namespace: "databases", name: first("ScheduledBackup").name }],
    });
  });

  it("names the kind for logical replication, whose two kinds share one list", () => {
    expect(destinationOf(first("Publication"))).toEqual({
      title: "Opens the publication",
      opens: ["logical", { namespace: "databases", name: "legacy-pub", kind: "Publication" }],
    });
    expect(destinationOf(first("Subscription")).opens).toEqual([
      "logical",
      { namespace: "databases", name: "billing-sub", kind: "Subscription" },
    ]);
  });
});

describe("naming a row", () => {
  it("needs both the namespace and the name", () => {
    expect(namedKey("databases", "orders-db")).toBe("databases/orders-db");
    expect(namedKey(undefined, "orders-db")).toBeUndefined();
    expect(namedKey("databases", "")).toBeUndefined();
  });

  it("keys an object's cluster as the cluster's row is keyed", () => {
    const orders = clusterNamed("orders-db");
    const own = backups().filter(
      (backup) => clusterKeyOf(backup) === `${orders.getNs()}/${orders.getName()}`,
    );

    // The Backups list narrowed from the drawer holds what the drawer counted.
    expect(own.map((backup) => backup.getName()).sort()).toEqual(
      indexInventory(inventory())
        .backupsOf(orders)
        .map((backup) => backup.getName())
        .sort(),
    );
    expect(own.length).toBeGreaterThan(0);
  });
});

describe("links to the host's lists", () => {
  it("searches each list by name", () => {
    expect(hostListOf("Pod", "orders-db-1")).toBe("/pods?search=orders-db-1");
    expect(hostListOf("Node", "a b")).toBe("/nodes?search=a%20b");
    expect(hostListOf("PersistentVolumeClaim", "orders-db-1")).toBe(
      "/persistent-volume-claims?search=orders-db-1",
    );
    expect(hostListOf("Secret", "orders-db-server")).toBe("/secrets?search=orders-db-server");
  });
});

describe("searching a list", () => {
  it("finds every row by its namespace", () => {
    const ok = { tone: "ok" as const, label: "Active", reason: "" };
    const logical = logicalRows(publications(), subscriptions());

    expect(searchRows(backups(), "databases", backupSearchTexts)).toHaveLength(backups().length);
    expect(
      searchRows(schedules(), "databases", (schedule) => scheduleSearchTexts(schedule, ok)),
    ).toHaveLength(schedules().length);
    expect(
      searchRows(poolers(), "databases", (pooler) => poolerSearchTexts(pooler, ok)),
    ).toHaveLength(poolers().length);
    expect(searchRows(logical, "databases", logicalSearchTexts)).toHaveLength(logical.length);
  });
});

describe("searching the Clusters list", () => {
  const textsOf = (name: string) => {
    const row = clusterRows(full(), now).find((each) => each.cluster.getName() === name);

    return row ? clusterSearchTexts(row) : [];
  };

  it("finds a replica cluster by the cluster it replays", () => {
    expect(textsOf("orders-replica-db")).toContain("replica of orders-db");
  });

  it("gives a primary cluster no replica text", () => {
    expect(textsOf("orders-db").some((text) => text.includes("replica of"))).toBe(false);
  });
});

describe("the selection bar's tooltips", () => {
  it("say what the action does, as the drawer's toolbar does", () => {
    expect(bulkEffect("reload")).toBe(
      "Reloads the configuration without restarting, on each ticked cluster that can take it.",
    );
    expect(bulkEffect("hibernate").startsWith(CLUSTER_EFFECTS.hibernate)).toBe(true);
  });
});

describe("a time still to come", () => {
  it("reads as how long until it", () => {
    expect(until(new Date(now + 3 * 3_600_000).toISOString(), now)).toBe("in 3h");
    expect(until(new Date(now + 90 * 60_000).toISOString(), now)).toBe("in 1h");
    expect(until(new Date(now - 60_000).toISOString(), now)).toBe("due");
    expect(until(undefined, now)).toBe("—");
    expect(until("never", now)).toBe("—");
  });
});
