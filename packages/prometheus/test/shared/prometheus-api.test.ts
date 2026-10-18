import { describe, expect, it } from "vitest";
import { keyedTargets, shownInstance } from "../../src/renderer/api/monitors/scrape-pools";
import {
  PrometheusApiError,
  parseAlertmanagers,
  parseAllocatorJobs,
  parsePools,
  parseRules,
  parseTargets,
  withoutQuery,
} from "../../src/renderer/api/shared/prometheus-api";
import {
  alertmanagersBody,
  allocatorReads,
  poolsBody,
  rulesBody,
  targetsBody,
} from "../support/fixtures";

describe("the Prometheus API answers", () => {
  it("targets keep what the page shows and nothing of discoveredLabels", () => {
    const targets = parseTargets(targetsBody());
    const down = targets.find((each) => each.health === "down");

    expect(targets).toHaveLength(8);
    expect(down).toEqual({
      scrapePool: "serviceMonitor/monitoring/down-path/0",
      labels: expect.objectContaining({ job: "prometheus-operated" }),
      scrapeUrl: "http://198.51.100.11:9090/does-not-exist",
      health: "down",
      lastError: "server returned HTTP status 404 Not Found",
      lastScrape: "2026-10-12T16:35:23.676660175Z",
      scrapeInterval: "30s",
    });
    expect(Object.keys(down ?? {})).not.toContain("discoveredLabels");
  });

  it("drops an endpoint's params from the URL and from errors that quote it", () => {
    const [first] = (targetsBody() as { data: { activeTargets: Record<string, unknown>[] } }).data
      .activeTargets;
    const withParams = {
      status: "success",
      data: {
        activeTargets: [
          {
            ...first,
            health: "sideways",
            scrapeUrl: `${String(first?.scrapeUrl)}?token=abc&module=x`,
            lastError: `Get "${String(first?.scrapeUrl)}?token=abc": context deadline exceeded`,
          },
        ],
      },
    };
    const [target] = parseTargets(withParams);

    expect(target?.scrapeUrl).toBe(first?.scrapeUrl);
    expect(target?.lastError).toBe(`Get "${String(first?.scrapeUrl)}": context deadline exceeded`);
    expect(target?.health).toBe("unknown");
    expect(withoutQuery("https://198.51.100.10:10250/metrics#x")).toBe(
      "https://198.51.100.10:10250/metrics",
    );
  });

  it("targets on one exporter, told apart by params, get their own keys and instances", () => {
    const [first] = parseTargets(targetsBody());

    if (!first) throw new Error("no target in the fixture");

    const probe = (target: string, instance: string) => ({
      ...first,
      scrapeUrl: withoutQuery(`${first.scrapeUrl}?target=${target}`),
      labels: { ...first.labels, instance },
    });
    const relabelled = [probe("a", "a.example.test"), probe("b", "b.example.test")];
    const same = [probe("a", first.labels.instance ?? ""), probe("b", first.labels.instance ?? "")];

    expect(new Set(keyedTargets(relabelled).map((each) => each.key)).size).toBe(2);
    expect(relabelled.map(shownInstance)).toEqual(["a.example.test", "b.example.test"]);
    expect(new Set(keyedTargets(same).map((each) => each.key)).size).toBe(2);
    expect(same.map(shownInstance)).toEqual([undefined, undefined]);
  });

  it("pools and rule groups", () => {
    expect(parsePools(poolsBody())).toContain("serviceMonitor/prom-apps/wrong-port/0");
    expect(parseRules(rulesBody()).map((group) => group.name)).toEqual([
      "seed",
      "seed-failing",
      "seed-pending",
      "seed-recording",
    ]);
  });

  it("the Alertmanagers it sends to, not the ones it dropped", () => {
    const blank = { status: "success", data: { activeAlertmanagers: [{}] } };

    expect(parseAlertmanagers(alertmanagersBody())).toEqual([
      "http://198.51.100.10:9093/api/v2/alerts",
    ]);
    expect(parseAlertmanagers({ status: "success", data: {} })).toEqual([]);
    expect(parseAlertmanagers(blank)).toEqual([""]);
  });

  it("missing lists read as empty, missing fields as blanks", () => {
    expect(parsePools({ status: "success", data: {} })).toEqual([]);
    expect(parseRules({ status: "success", data: { groups: [{}] } })).toEqual([
      { name: "", file: "", rules: [] },
    ]);
    expect(parseTargets({ status: "success", data: { activeTargets: [{}] } })).toEqual([
      {
        scrapePool: "",
        labels: {},
        scrapeUrl: "",
        health: "unknown",
        lastError: "",
        lastScrape: undefined,
        scrapeInterval: undefined,
      },
    ]);
  });

  it("an error status throws with its type", () => {
    const refused = { status: "error", errorType: "bad_data", error: "invalid parameter" };

    expect(() => parseTargets(refused)).toThrow(PrometheusApiError);
    expect(() => parseAlertmanagers(refused)).toThrow("invalid parameter");

    const thrown = (() => {
      try {
        parsePools(undefined);
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).toBeInstanceOf(PrometheusApiError);
  });
});

describe("a TargetAllocator's /jobs", () => {
  it("gives the job names, which are the operator's pool names", () => {
    expect(allocatorReads()).toEqual([
      {
        source: "TargetAllocator/otel-collectors/scraper",
        pools: ["serviceMonitor/prom-apps/otel-self/0"],
      },
    ]);
  });

  it("refuses an answer that is not an object of jobs", () => {
    for (const answer of [undefined, null, "jobs", ["serviceMonitor/prom-apps/otel-self/0"]]) {
      expect(() => parseAllocatorJobs(answer)).toThrow(PrometheusApiError);
    }
  });
});
