import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { describeUptime, metricsPath, parseMetrics, totalBytes } from "../src/renderer/api/summary";
import { clusterNamed, variantOf } from "./fixtures";

const exported = readFileSync(resolve(__dirname, "fixtures/metrics.txt"), "utf8");

describe("the exporter's metrics", () => {
  const metrics = parseMetrics(exported);

  it("reads when Postgres started, in ms", () => {
    expect(metrics.startedAt).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
    expect(Number.isInteger(Math.round(metrics.startedAt ?? 0))).toBe(true);
  });

  it("reads each database's size, largest first, without the templates", () => {
    expect(metrics.databases.map((each) => each.name)).toEqual(["app", "postgres"]);
    const [app, postgres] = metrics.databases;

    expect(app?.bytes).toBeGreaterThan(0);
    expect(totalBytes(metrics)).toBe((app?.bytes ?? 0) + (postgres?.bytes ?? 0));
  });

  it("skips comments, other metrics and values that are not numbers", () => {
    expect(
      parseMetrics("# HELP x\nother_metric 3\ncnpg_pg_postmaster_start_time NaNish\n"),
    ).toEqual({
      databases: [],
    });
    expect(parseMetrics('cnpg_pg_database_size_bytes{other="x"} 5\n').databases).toEqual([]);
  });

  it("says how long Postgres has been up, and nothing without a start time", () => {
    expect(describeUptime({ startedAt: 0, databases: [] }, 3 * 3_600_000)).toBe("3h");
    expect(describeUptime({ databases: [] }, 0)).toBeUndefined();
  });
});

describe("where to read them", () => {
  it("is plain HTTP on port 9187 through the API server", () => {
    expect(metricsPath(clusterNamed("orders-db"), "orders-db-2")).toBe(
      "/api/v1/namespaces/databases/pods/orders-db-2:9187/proxy/metrics",
    );
  });

  it("is HTTPS when the cluster turned TLS on for the exporter", () => {
    const secured = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.monitoring = { tls: { enabled: true } };
    });

    expect(metricsPath(secured, "orders-db-2")).toContain("/pods/https:orders-db-2:9187/");
  });
});
