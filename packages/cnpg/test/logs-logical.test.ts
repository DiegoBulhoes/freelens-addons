import { describe, expect, it } from "vitest";

import { dropsInPostgres, logicalRows, logicalVerdict } from "../src/renderer/api/logical";
import { mergeLogs, parseLog } from "../src/renderer/api/logs";
import { postgresLog, publications, subscriptions, variantOf } from "./fixtures";

describe("the instances' log, in one stream", () => {
  const entries = parseLog(postgresLog());

  it("reads Postgres records and the instance manager's own lines, with the pod of each", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((entry) => entry.pod)).size).toBeGreaterThan(1);
    expect(entries.some((entry) => entry.logger === "postgres")).toBe(true);
    expect(entries.every((entry) => entry.message.length > 0 && entry.message !== "record")).toBe(
      true,
    );
  });

  it("puts the newest first and keeps only what is asked for", () => {
    const merged = mergeLogs([postgresLog()], "info", 10);

    expect(merged).toHaveLength(10);
    expect(merged.map((entry) => entry.at)).toEqual(
      [...merged.map((entry) => entry.at)].sort().reverse(),
    );
  });

  it("narrows to warnings and errors", () => {
    const fatal = JSON.stringify({
      ts: "2030-01-01T00:00:00Z",
      logging_pod: "orders-db-1",
      logger: "postgres",
      msg: "record",
      record: { error_severity: "FATAL", message: "the end" },
    });
    const warned = JSON.stringify({
      ts: "2030-01-01T00:00:01Z",
      logging_pod: "orders-db-2",
      level: "warning",
      msg: "careful",
    });
    const merged = mergeLogs([postgresLog(), `${fatal}\n${warned}`], "warning", 50);

    expect(merged.slice(0, 2).map((entry) => [entry.level, entry.message])).toEqual([
      ["warning", "careful"],
      ["error", "the end"],
    ]);
    expect(merged.every((entry) => entry.level !== "info")).toBe(true);
    expect(mergeLogs([fatal], "error", 5)).toHaveLength(1);
  });

  it("folds a pod repeating itself into its newest line, with a count", () => {
    const line = (ts: string) =>
      JSON.stringify({
        ts,
        logging_pod: "orders-db-2",
        logger: "postgres",
        msg: "record",
        record: { error_severity: "ERROR", message: "again" },
      });
    const merged = mergeLogs(
      [
        [
          line("2030-01-01T00:00:01Z"),
          line("2030-01-01T00:00:03Z"),
          line("2030-01-01T00:00:02Z"),
        ].join("\n"),
      ],
      "error",
      5,
    );

    expect(merged).toEqual([expect.objectContaining({ at: "2030-01-01T00:00:03Z", times: 3 })]);
  });

  it("skips what is not a line of ours", () => {
    expect(
      parseLog(`plain text\n{}\n${JSON.stringify({ ts: "x", logging_pod: "p", msg: "record" })}`),
    ).toEqual([]);
    expect(
      parseLog(JSON.stringify({ ts: "x", logging_pod: "p", msg: "failed", error: "boom" }))[0]
        ?.message,
    ).toBe("failed: boom");
  });
});

describe("publications and subscriptions", () => {
  const rows = logicalRows(publications(), subscriptions());

  it("lists both kinds, each with its cluster, database and peer", () => {
    expect(rows.map((row) => `${row.kind}/${row.object.getName()}`).sort()).toEqual([
      "Publication/legacy-pub",
      "Publication/orders-pub",
      "Subscription/billing-sub",
      "Subscription/orders-sub",
    ]);
    expect(rows.find((row) => row.object.getName() === "orders-sub")?.peer).toBe(
      "orders_pub on orders",
    );
    expect(rows.find((row) => row.object.getName() === "orders-pub")?.peer).toBe("all tables");
  });

  it("is applied, or not with the operator's message", () => {
    expect(rows.find((row) => row.object.getName() === "orders-pub")?.verdict.label).toBe(
      "Applied",
    );
    expect(rows.find((row) => row.object.getName() === "billing-sub")?.verdict).toMatchObject({
      tone: "critical",
      reason: expect.stringContaining("externalCluster 'billing' not declared"),
    });
  });

  it("is pending before the operator reports, and some tables when not all", () => {
    const [publication] = publications();
    if (!publication) throw new Error("no publication in the fixtures");

    const fresh = variantOf(publication, (raw) => {
      raw.status = undefined;
      raw.spec.target = { objects: [] };
    });
    const silent = variantOf(publication, (raw) => {
      raw.status = { applied: false };
    });

    expect(logicalVerdict(fresh).label).toBe("Pending");
    expect(logicalRows([fresh], [])[0]?.peer).toBe("some tables");
    expect(logicalVerdict(silent).reason).toBe("The operator could not apply it.");
  });

  it("drops it in Postgres only when its reclaim policy says delete", () => {
    expect(rows.every((row) => !dropsInPostgres(row))).toBe(true);

    const [publication] = publications();
    const [subscription] = subscriptions();
    if (!publication || !subscription) throw new Error("fixtures need both kinds");

    const doomed = logicalRows(
      [
        variantOf(publication, (raw) => {
          raw.spec.publicationReclaimPolicy = "delete";
        }),
      ],
      [
        variantOf(subscription, (raw) => {
          raw.spec.subscriptionReclaimPolicy = "delete";
        }),
      ],
    );

    expect(doomed.every(dropsInPostgres)).toBe(true);
  });
});
