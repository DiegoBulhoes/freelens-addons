import { describe, expect, it } from "vitest";
import {
  healthByMonitor,
  mergeShards,
  parsePool,
  poolsLoaded,
} from "../../src/renderer/api/monitors/scrape-pools";
import { parsePools, parseTargets } from "../../src/renderer/api/shared/prometheus-api";
import { poolsBody, reads, targetsBody } from "../support/fixtures";

describe("scrape pool names", () => {
  it("map back to the monitor and its endpoint", () => {
    expect(parsePool("serviceMonitor/monitoring/kubelet/1")).toEqual({
      kind: "ServiceMonitor",
      namespace: "monitoring",
      name: "kubelet",
      index: 1,
    });
    expect(parsePool("podMonitor/prom-apps/prom-pods/0")?.kind).toBe("PodMonitor");
    expect(parsePool("scrapeConfig/prom-apps/static-self")).toEqual({
      kind: "ScrapeConfig",
      namespace: "prom-apps",
      name: "static-self",
      index: undefined,
    });
    expect(parsePool("probe/monitoring/blackbox")?.kind).toBe("Probe");
  });

  it("from additionalScrapeConfigs map to nothing", () => {
    expect(parsePool("kubernetes-pods")).toBeUndefined();
    expect(parsePool("serviceMonitor/monitoring")).toBeUndefined();
  });
});

describe("loaded pools", () => {
  it("hold every selected, valid monitor; rejected and unselected ones are absent", () => {
    const loaded = poolsLoaded([...parsePools(poolsBody()), "kubernetes-pods"]);

    expect(loaded.get("ServiceMonitor/monitoring/kubelet")).toEqual(new Set([0, 1]));
    expect(loaded.has("ServiceMonitor/prom-apps/no-service")).toBe(true);
    expect(loaded.has("ScrapeConfig/prom-apps/static-self")).toBe(true);
    expect(loaded.has("ServiceMonitor/monitoring/rejected")).toBe(false);
    expect(loaded.has("ServiceMonitor/prom-apps/orphan")).toBe(false);
  });
});

describe("health per monitor", () => {
  const health = () => healthByMonitor(parseTargets(targetsBody()));

  it("prom-self is up and down-path down, with its error", () => {
    expect(health().get("ServiceMonitor/monitoring/prom-self")).toMatchObject({ up: 1, down: 0 });
    expect(health().get("ServiceMonitor/monitoring/down-path")).toMatchObject({
      up: 0,
      down: 1,
      errors: [
        {
          pool: "serviceMonitor/monitoring/down-path/0",
          scrapeUrl: "http://198.51.100.11:9090/does-not-exist",
          lastError: "server returned HTTP status 404 Not Found",
        },
      ],
    });
  });

  it("no-service is loaded but has no target, and kubelet sums both endpoints", () => {
    expect(health().has("ServiceMonitor/prom-apps/no-service")).toBe(false);
    expect(health().get("ServiceMonitor/monitoring/kubelet")?.up).toBe(2);
  });

  it("counts a target not yet scraped apart, and skips a pool it cannot name", () => {
    const targets = parseTargets(targetsBody());
    const [first] = targets;
    const fresh = first
      ? [
          { ...first, health: "unknown" as const },
          { ...first, scrapePool: "kubernetes-pods" },
        ]
      : [];

    expect(healthByMonitor(fresh).get("PodMonitor/monitoring/node-exporter")).toMatchObject({
      unknown: 1,
      up: 0,
    });
    expect(healthByMonitor(fresh).size).toBe(1);
  });
});

describe("merging shards", () => {
  it("one shard as read from the export", () => {
    const [seed] = reads();

    expect(seed?.source).toBe("Prometheus/monitoring/seed");
    expect(seed?.error).toBeUndefined();
    expect(seed?.pools).toHaveLength(11);
    expect(seed?.targets).toHaveLength(8);
    expect(seed?.groups).toHaveLength(4);
  });

  it("adds the targets of each shard and keeps one copy of each pool", () => {
    const targets = parseTargets(targetsBody());
    const pools = parsePools(poolsBody());
    const merged = mergeShards("Prometheus/monitoring/seed", [
      { targets: targets.slice(0, 3), pools },
      { targets: targets.slice(3), pools },
    ]);

    expect(merged.targets).toEqual(targets);
    expect(merged.pools).toEqual(pools);
  });

  it("is unknown when a shard fails or none answered, and leaves out what was not read", () => {
    const pools = parsePools(poolsBody());

    expect(mergeShards("x", [{ pools }, { error: "503 Service Unavailable" }])).toEqual({
      source: "x",
      error: "503 Service Unavailable",
    });
    expect(mergeShards("x", []).error).toBe("No Prometheus pod is running and ready");
    expect(mergeShards("x", [{ pools }, { pools }])).toEqual({
      source: "x",
      pools,
      targets: undefined,
      groups: undefined,
    });
  });
});
