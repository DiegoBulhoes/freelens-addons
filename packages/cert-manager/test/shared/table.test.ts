import { describe, expect, it } from "vitest";

import { describeCount, nextSort, searchRows, sortRows } from "../../src/renderer/api/shared/table";
import type { SecretLike } from "../../src/renderer/api/shared/types";
import {
  getServedTls,
  getUnmanagedSecrets,
  SERVED_STATES,
  type ServedTls,
  secretSearchTexts,
  servedSearchTexts,
} from "../../src/renderer/api/unmanaged/unmanaged";
import { certificates, ingresses, tlsSecrets } from "../support/fixtures";

const served = getServedTls(ingresses(), tlsSecrets(), certificates());
const secrets = getUnmanagedSecrets(tlsSecrets(), certificates());

const servedValue = (entry: ServedTls, column: string) =>
  column === "State" ? SERVED_STATES[entry.state].rank : entry.certificate;
const secretValue = (secret: SecretLike, column: string) =>
  column === "Created" ? secret.metadata.creationTimestamp : secret.getName();

describe("searching the served list", () => {
  it("finds an entry by a host it serves, ignoring case", () => {
    expect(
      searchRows(served, "UNMANAGED.demo", servedSearchTexts).map((each) => each.ingress),
    ).toEqual(["unmanaged"]);
  });

  it("finds entries by the word for their state", () => {
    expect(searchRows(served, "missing", servedSearchTexts).map((each) => each.ingress)).toEqual([
      "missing-secret",
    ]);
  });

  it("needs every word to match", () => {
    expect(searchRows(served, "managed nowhere", servedSearchTexts)).toEqual([]);
  });

  it("keeps every row for an empty query", () => {
    expect(searchRows(served, "  ", servedSearchTexts)).toBe(served);
  });
});

describe("searching the Secrets list", () => {
  it("finds a Secret by its namespace", () => {
    expect(
      searchRows(secrets, "kube-system", secretSearchTexts).map((each) => each.getName()),
    ).toEqual(["k3s-serving"]);
  });
});

describe("sorting a table", () => {
  it("orders the served list by state, worst first, and back", () => {
    const ascending = sortRows(served, { column: "State", direction: "ascending" }, servedValue);
    const descending = sortRows(served, { column: "State", direction: "descending" }, servedValue);

    expect(ascending.map((each) => each.state)).toEqual([
      "unmanaged",
      "missing",
      "pending",
      "managed",
    ]);
    expect(descending.map((each) => each.state)).toEqual([
      "managed",
      "pending",
      "missing",
      "unmanaged",
    ]);
  });

  it("puts an entry with no Certificate last in both directions", () => {
    for (const direction of ["ascending", "descending"] as const) {
      const sorted = sortRows(served, { column: "Certificate", direction }, servedValue);

      const named = ["acme-web", "managed-tls"];

      expect(sorted.slice(0, 2).map((each) => each.certificate)).toEqual(
        direction === "ascending" ? named : [...named].reverse(),
      );
      expect(sorted.slice(2).every((each) => each.certificate === undefined)).toBe(true);
    }
  });

  it("orders Secrets by when they were made, keeping ties in their order", () => {
    const oldest = sortRows(secrets, { column: "Created", direction: "ascending" }, secretValue);

    // hand-made-tls and leftover-tls, and the databases ones, share a second.
    expect(oldest.map((each) => each.getName())).toEqual([
      "k3s-serving",
      "hand-made-tls",
      "leftover-tls",
      "cnpg-webhook-cert",
      "analytics-db-replication",
      "analytics-db-server",
      "billing-db-replication",
      "billing-db-server",
      "inventory-db-replication",
      "orders-db-replication",
      "orders-db-server",
      "reports-db-replication",
      "reports-db-server",
      "orders-db-pooler",
      "retired-tls",
      "reports-db-pooler",
      "audit-db-replication",
      "audit-db-server",
    ]);
  });

  it("orders names as people read them", () => {
    const names = sortRows(secrets, { column: "Name", direction: "descending" }, secretValue).map(
      (each) => each.getName(),
    );

    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  });

  it("keeps the page's own order without a sort", () => {
    expect(sortRows(served, undefined, servedValue)).toBe(served);
  });

  it("cycles a header through ascending, descending and none", () => {
    const first = nextSort(undefined, "State");
    const second = nextSort(first, "State");

    expect(first?.direction).toBe("ascending");
    expect(second?.direction).toBe("descending");
    expect(nextSort(second, "State")).toBeUndefined();
    expect(nextSort(second, "Ingress")).toEqual({ column: "Ingress", direction: "ascending" });
  });
});

describe("counting a table", () => {
  it("says how many, and how many of how many while a search narrows it", () => {
    expect(describeCount(1, 1)).toBe("1 item");
    expect(describeCount(served.length, served.length)).toBe(`${served.length} items`);
    expect(describeCount(1, served.length)).toBe(`1 of ${served.length} items`);
  });
});
