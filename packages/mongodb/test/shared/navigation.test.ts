import { describe, expect, it } from "vitest";
import { membersOf, primaryLabel } from "../../src/renderer/api/clusters/members";
import {
  agentsOf,
  attentionItems,
  countsOf,
  describeMissingTls,
  type Inventory,
  replicaSetRows,
} from "../../src/renderer/api/clusters/rows";
import { hostListOf } from "../../src/renderer/api/shared/host-links";
import {
  cardsOf,
  destinationOf,
  isReplicaSetFilter,
  matchesReplicaSetFilter,
  namedKey,
  REPLICA_SET_FILTER_LABELS,
  REPLICA_SET_FILTERS,
} from "../../src/renderer/api/shared/navigation";
import type { ReplicaSetLike } from "../../src/renderer/api/shared/types";
import { agents, inventory, named, pods, pvcs, replicaSets } from "../support/fixtures";

const names = (rows: ReturnType<typeof replicaSetRows>) => rows.map((row) => row.rs.getName());

// catalog-rs as its agents would read it once catalog-rs-2 stepped down and no one took over.
function withoutPrimary(): Inventory {
  return {
    ...inventory(),
    agents: Object.fromEntries(
      Object.entries(agents()).map(([key, view]) => [
        key,
        key === "mongodb/catalog-rs-2" && view ? { ...view, role: "secondary" as const } : view,
      ]),
    ),
  };
}

// secure-rs pointed at a TLS Secret nobody created, as when its Certificate never issues.
function secureWithTls(secret: string, status?: ReplicaSetLike["status"]): ReplicaSetLike {
  const rs = named(replicaSets(), "secure-rs");
  const tls = rs.spec.security?.tls;

  return {
    ...rs,
    getName: () => rs.getName(),
    getNs: () => rs.getNs(),
    spec: {
      ...rs.spec,
      security: {
        ...rs.spec.security,
        tls: {
          ...tls,
          enabled: true,
          certificateKeySecretRef: { name: secret },
          caCertificateSecretRef: { name: secret },
        },
      },
    },
    status: status ?? rs.status,
  } as ReplicaSetLike;
}

const withSecure = (rs: ReplicaSetLike, from: Inventory = inventory()): Inventory => ({
  ...from,
  replicaSets: from.replicaSets.map((each) => (each.getName() === "secure-rs" ? rs : each)),
});

// reporting-rs with a second user whose password Secret is missing too: still one cluster.
function withTwoPasswordless(): Inventory {
  const from = inventory();

  return {
    ...from,
    replicaSets: from.replicaSets.map((rs) => {
      if (rs.getName() !== "reporting-rs") return rs;
      const [user] = rs.spec.users ?? [];

      return {
        ...rs,
        getName: () => rs.getName(),
        getNs: () => rs.getNs(),
        spec: {
          ...rs.spec,
          users: [
            ...(rs.spec.users ?? []),
            { ...user, name: "analyst", passwordSecretRef: { name: "analyst-password" } },
          ],
        },
      } as ReplicaSetLike;
    }),
  };
}

describe("an overview card", () => {
  it("counts exactly the rows the list filter it opens keeps", () => {
    for (const from of [inventory(), withoutPrimary(), withTwoPasswordless()]) {
      const rows = replicaSetRows(from);

      for (const card of cardsOf(countsOf(rows), "ready")) {
        expect(
          rows.filter((row) => matchesReplicaSetFilter(row, card.opens.filter)).length,
          card.label,
        ).toBe(card.value);
      }
    }
  });

  it("opens the list on its own filter, and Clusters on every cluster", () => {
    const cards = cardsOf(countsOf(replicaSetRows(inventory())), "ready");

    expect(cards.map((card) => card.opens)).toEqual([
      {},
      { filter: "critical" },
      { filter: "degraded" },
      { filter: "changing-version" },
      { filter: "no-password" },
      { filter: "no-tls-secret" },
    ]);
    expect(cards[2]?.title).toBe("Opens the clusters with some of their members not ready");
  });

  it("is not shown before the lists are read, where a zero would claim what no list said", () => {
    const counts = countsOf(replicaSetRows(inventory()));

    for (const state of ["connecting", "unreachable", "not-installed"] as const) {
      expect(cardsOf(counts, state), state).toEqual([]);
    }
  });

  it("keeps each filter to its own clusters: a set changing version is not degraded", () => {
    const rows = replicaSetRows(inventory());
    const kept = Object.fromEntries(
      REPLICA_SET_FILTERS.map((filter) => [
        filter,
        names(rows.filter((row) => matchesReplicaSetFilter(row, filter))),
      ]),
    );

    expect(kept).toEqual({
      critical: ["legacy-rs", "reporting-rs"],
      degraded: ["ledger-rs"],
      "changing-version": ["upgrade-rs"],
      "no-password": ["reporting-rs"],
      "no-tls-secret": [],
    });
    expect(names(rows.filter((row) => matchesReplicaSetFilter(row, undefined)))).toEqual(
      names(rows),
    );
  });

  it("names No primary in the critical card, which counts it", () => {
    const rows = replicaSetRows(withoutPrimary());
    const catalog = rows.find((row) => row.rs.getName() === "catalog-rs");

    expect(catalog?.health.label).toBe("No primary");
    expect(catalog && matchesReplicaSetFilter(catalog, "critical")).toBe(true);
    expect(REPLICA_SET_FILTER_LABELS.critical).toBe("Down, failed or no primary");
  });

  it("reads only a known filter from the route", () => {
    expect(isReplicaSetFilter("degraded")).toBe(true);
    expect(isReplicaSetFilter("down")).toBe(false);
    expect(isReplicaSetFilter(undefined)).toBe(false);
  });
});

describe("an attention row", () => {
  it("opens its own cluster's drawer, by namespace and name, whatever the row is about", () => {
    const from = withSecure(secureWithTls("secure-rs-tls-renewed"));
    const items = attentionItems(replicaSetRows(from));
    const [first] = items;
    const secret = items.find((item) => item.kind === "Secret");

    expect(first && destinationOf(first)).toEqual({ namespace: "mongodb", name: "legacy-rs" });
    expect(secret && destinationOf(secret)).toEqual({ namespace: "mongodb", name: "secure-rs" });
    expect(namedKey("mongodb", "secure-rs")).toBe("mongodb/secure-rs");
    expect(namedKey(undefined, "secure-rs")).toBeUndefined();
    expect(namedKey("mongodb", "")).toBeUndefined();
  });
});

describe("the attention list", () => {
  it("puts a critical row before a warning one, keeping the clusters' order within a tone", () => {
    const items = attentionItems(
      replicaSetRows(withSecure(secureWithTls("secure-rs-tls-renewed"))),
    );

    expect(items.map((item) => [item.kind, item.name, item.verdict.tone])).toEqual([
      ["Cluster", "legacy-rs", "critical"],
      ["Cluster", "reporting-rs", "critical"],
      ["Secret", "secure-rs-tls-renewed", "critical"],
      ["Cluster", "ledger-rs", "warning"],
      ["Cluster", "upgrade-rs", "warning"],
    ]);
  });
});

describe("a missing TLS Secret", () => {
  it("is the cause of a set with no member up", () => {
    const stuck = secureWithTls("secure-rs-tls-renewed", { phase: "Pending" });
    const from = {
      ...withSecure(stuck),
      pods: pods().filter((pod) => pod.getName() !== "secure-rs-0"),
    };
    const row = replicaSetRows(from).find((each) => each.rs.getName() === "secure-rs");

    expect(row?.health).toEqual({
      tone: "critical",
      label: "Down",
      reason:
        "Its TLS Secret secure-rs-tls-renewed does not exist, so the operator starts no member.",
    });
    // Already named by the cluster's own row.
    expect(attentionItems(replicaSetRows(from)).filter((item) => item.kind === "Secret")).toEqual(
      [],
    );
  });

  it("needs attention on a running set, and is kept by its filter", () => {
    const rows = replicaSetRows(withSecure(secureWithTls("secure-rs-tls-renewed")));
    const row = rows.find((each) => each.rs.getName() === "secure-rs");

    expect(row?.health.tone).toBe("ok");
    expect(attentionItems(rows).filter((item) => item.kind === "Secret")).toEqual([
      {
        kind: "Secret",
        name: "secure-rs-tls-renewed",
        replicaSet: "secure-rs",
        namespace: "mongodb",
        verdict: {
          tone: "critical",
          label: "No TLS Secret",
          reason:
            "Its TLS Secret secure-rs-tls-renewed does not exist: the operator cannot reconcile the cluster meanwhile.",
        },
      },
    ]);
    expect(names(rows.filter((each) => matchesReplicaSetFilter(each, "no-tls-secret")))).toEqual([
      "secure-rs",
    ]);
  });

  it("names both Secrets when the certificate and the CA are each missing", () => {
    expect(describeMissingTls(["a-tls", "a-ca"])).toBe(
      "Its TLS Secrets a-tls and a-ca do not exist",
    );
  });

  it("is not raised before its namespace's Secrets are listed", () => {
    const rows = replicaSetRows({
      ...withSecure(secureWithTls("secure-rs-tls-renewed")),
      secrets: undefined,
    });

    expect(attentionItems(rows).some((item) => item.kind === "Secret")).toBe(false);
  });
});

describe("the Primary column", () => {
  it("names the primary, says unknown while a ready member's role is unread, and — when none is up", () => {
    const rs = catalog();

    expect(primaryLabel(membersOf(rs, pods(), pvcs(), agentsOf(rs, agents())))).toBe(
      "catalog-rs-2",
    );
    expect(primaryLabel(membersOf(rs, pods(), pvcs(), {}))).toBe("unknown");

    const legacy = named(replicaSets(), "legacy-rs");

    expect(primaryLabel(membersOf(legacy, pods(), pvcs(), agentsOf(legacy, agents())))).toBe("—");
  });
});

describe("links to the host", () => {
  it("opens each host list searched by the object's name", () => {
    expect(hostListOf("Pod", "catalog-rs-0")).toBe("/pods?search=catalog-rs-0");
    expect(hostListOf("Node", "a b")).toBe("/nodes?search=a%20b");
    expect(hostListOf("PersistentVolumeClaim", "data-volume-catalog-rs-0")).toBe(
      "/persistent-volume-claims?search=data-volume-catalog-rs-0",
    );
    expect(hostListOf("Secret", "secure-rs-tls")).toBe("/secrets?search=secure-rs-tls");
  });

  it("knows each member's volume claim, to link it", () => {
    const rs = catalog();

    expect(membersOf(rs, pods(), pvcs(), {}).map((each) => each.pvc)).toEqual([
      "data-volume-catalog-rs-0",
      "data-volume-catalog-rs-1",
      "data-volume-catalog-rs-2",
    ]);
  });
});

function catalog() {
  return named(replicaSets(), "catalog-rs");
}
