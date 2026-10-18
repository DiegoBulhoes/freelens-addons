import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectorRows } from "../../src/renderer/api/collectors/collectors";
import {
  anyRefused,
  mergeListings,
  namesFrom,
  settledListings,
} from "../../src/renderer/api/coverage/reference-names";
import {
  collectorWorkloadOf,
  hostListOf,
  monitorsListOf,
} from "../../src/renderer/api/shared/host-links";
import { CRD_NAMES, isInstalled } from "../../src/renderer/api/shared/installed";
import {
  byNamespace,
  everyNamespace,
  everywhereKey,
  scopeKey,
  withinScope,
} from "../../src/renderer/api/shared/namespace-scope";
import { nextReadDelay, RELIST_MS } from "../../src/renderer/api/shared/retry";
import {
  describeLoadState,
  loadedForScope,
  loadState,
  worstOf,
} from "../../src/renderer/api/shared/store-state";
import type { CollectorLike } from "../../src/renderer/api/shared/types";
import { ago, formatAge } from "../../src/renderer/api/shared/verdict";
import { describeOutcome, planFor } from "../../src/renderer/api/writes/bulk";
import {
  collectors,
  NOW,
  namespaces,
  podList,
  podOf,
  pods,
  secretNames,
  variant,
  workloads,
} from "../support/fixtures";

describe("installed", () => {
  it("with either kind the pages read", () => {
    expect(isInstalled([CRD_NAMES[0] ?? ""])).toBe(true);
    expect(isInstalled(["opentelemetrycollectors.opentelemetry.io"])).toBe(true);
    expect(isInstalled(["instrumentations.example.com"])).toBe(false);
  });
});

describe("bulk", () => {
  it("skips what an action refuses, saying why, and reports the outcome", () => {
    const plan = planFor([1, 2, 3], (n) => (n === 2 ? "even" : undefined));

    expect(plan).toEqual({ ready: [1, 3], skipped: [{ item: 2, reason: "even" }] });
    expect(describeOutcome("Restarted", 2, [])).toBe("Restarted 2 of 2.");
    expect(describeOutcome("Restarted", 1, ["a"])).toBe("Restarted 1 of 2. Failed: a.");
  });
});

describe("scope and load state", () => {
  it("keeps the namespaces in scope", () => {
    expect(withinScope(workloads(), ["otel-late"]).map((each) => each.getName())).toEqual([
      "late",
      "late-agent",
    ]);
    expect(withinScope(workloads(), ["other"])).toEqual([]);
    expect(scopeKey(["b", "a"])).toBe("a,b");
  });

  it("indexes items by namespace, a cluster-scoped one under none", () => {
    const index = byNamespace([...workloads(), ...namespaces()]);

    expect(index.get("otel-late")?.map((each) => each.getName())).toEqual(["late", "late-agent"]);
    expect(index.get("")).toHaveLength(namespaces().length);
    expect(index.get("other")).toBeUndefined();
  });

  it("tells not installed, connecting, unreachable and ready apart", () => {
    const facts = { registered: true, loaded: false, itemCount: 0, gaveUp: false };

    expect(loadState({ ...facts, registered: false })).toBe("not-installed");
    expect(loadState(facts)).toBe("connecting");
    expect(loadState({ ...facts, gaveUp: true })).toBe("unreachable");
    expect(loadState({ ...facts, itemCount: 1 })).toBe("ready");
    expect(describeLoadState("not-installed")).toMatch(/OpenTelemetry Operator is not installed/);
    expect(describeLoadState("connecting")).toMatch(/Connecting/);
    expect(describeLoadState("unreachable")).toMatch(/incomplete/);
    expect(describeLoadState("ready")).toBeUndefined();
  });

  it("is ready for a page only when every list it stands on is", () => {
    expect(worstOf("ready", "connecting")).toBe("connecting");
    expect(worstOf("ready", "unreachable")).toBe("unreachable");
    expect(worstOf("connecting", "unreachable")).toBe("unreachable");
    expect(worstOf("ready", "not-installed")).toBe("not-installed");
    expect(worstOf("ready", "ready")).toBe("ready");
    expect(worstOf()).toBe("ready");
  });

  it("waits until the host lists are loaded for this scope, not only loaded once", () => {
    const scope = scopeKey(["otel-apps", "otel-late"]);

    expect(loadedForScope([{ isLoaded: true }], scopeKey(["otel-apps"]), scope)).toBe(false);
    expect(loadedForScope([{ isLoaded: true }], undefined, scope)).toBe(false);
    expect(loadedForScope([{ isLoaded: false }], scope, scope)).toBe(false);
    expect(loadedForScope([{ isLoaded: true }, { isLoaded: true }], scope, scope)).toBe(true);
    expect(loadedForScope([{ isLoaded: true }], "", "")).toBe(true);
    expect(loadedForScope([{ isLoaded: true }], undefined, "")).toBe(false);
  });

  it("keys the every-namespace reads on the Namespace list being loaded, not on its names", () => {
    expect(everywhereKey(true, ["otel-late"])).toBe(everywhereKey(true, ["otel-apps"]));
    expect(everywhereKey(false, ["b", "a"])).toBe("a,b");
    expect(everywhereKey(true, [])).not.toBe(everywhereKey(false, []));

    const names = namespaces().map((each) => each.getName());

    expect(everyNamespace(names, ["otel-late"])).toEqual(names);
    expect(everyNamespace([], ["otel-late"])).toEqual(["otel-late"]);
  });
});

describe("reading again", () => {
  it("retries a refusal at 2s doubling up to a minute, and re-lists slowly otherwise", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(nextReadDelay)).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
    ]);
    expect(nextReadDelay(0)).toBe(RELIST_MS);
    expect(RELIST_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("verdicts and times", () => {
  it("says how long ago", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(72 * 3_600_000)).toBe("3d");
    expect(ago(undefined, 0)).toBe("—");
    expect(ago("nonsense", 0)).toBe("—");
    expect(ago("1970-01-01T00:00:00Z", 600_000)).toBe("10m ago");
    expect(ago("1970-01-01T00:00:00Z", 10_000)).toBe("just now");
  });
});

describe("host lists", () => {
  it("opens each kind's list searched by name", () => {
    expect(hostListOf("Pod", "late-1")).toBe("/pods?search=late-1");
    expect(hostListOf("Deployment", "late")).toBe("/deployments?search=late");
    expect(hostListOf("StatefulSet", "ledger")).toBe("/statefulsets?search=ledger");
    expect(hostListOf("DaemonSet", "a b")).toBe("/daemonsets?search=a%20b");
    expect(hostListOf("CronJob", "nightly")).toBe("/cronjobs?search=nightly");
    expect(hostListOf("Job", "migrate")).toBe("/jobs?search=migrate");
    expect(hostListOf("Instrumentation", "python")).toBe(
      "/crd/opentelemetry.io/instrumentations?search=python",
    );
    expect(hostListOf("OpenTelemetryCollector", "broken")).toBe(
      "/crd/opentelemetry.io/opentelemetrycollectors?search=broken",
    );
  });

  it("names the workload that owns each collector's pods, and none for a sidecar", () => {
    const rows = collectorRows(collectors(), pods(), new Map(), NOW);
    // A Deployment's pods belong to a ReplicaSet named after it plus a hash.
    const ownerOf = ({ kind, name }: { kind: string; name: string }) =>
      kind === "ReplicaSet"
        ? { kind: "Deployment", name: name.replace(/-[a-z0-9]+$/, "") }
        : { kind, name };
    const owned = rows
      .filter((row) => row.pods.length > 0 && row.mode !== "sidecar")
      .map((row) => {
        const [owner] = row.pods[0]?.metadata.ownerReferences ?? [];

        return [collectorWorkloadOf(row), owner && ownerOf(owner)];
      });

    const sidecar = rows.find((row) => row.mode === "sidecar");

    expect(owned.length).toBeGreaterThan(1);
    for (const [workload, owner] of owned) expect(workload).toEqual(owner);
    if (!sidecar) throw new Error("no sidecar collector in the fixture");
    expect(collectorWorkloadOf(sidecar)).toBeUndefined();
  });

  it("links a collector to the Prometheus Monitors when it makes or reads monitors", () => {
    const crds = ["servicemonitors.monitoring.coreos.com"];
    const rowOf = (name: string, list = collectors()) => {
      const found = collectorRows(list, pods(), new Map(), NOW).find((row) => row.name === name);

      if (!found) throw new Error(`no collector ${name}`);

      return found;
    };
    const gatewayWith = (change: (spec: CollectorLike["spec"]) => void) =>
      collectors().map((each) =>
        each.getName() === "gateway" ? variant(each, (data) => change(data.spec)) : each,
      );
    const metrics = gatewayWith((spec) => {
      spec.observability = { metrics: { enableMetrics: true } };
    });
    const unallocated = gatewayWith((spec) => {
      spec.targetAllocator = { ...spec.targetAllocator, prometheusCR: { enabled: true } };
    });

    expect(monitorsListOf(rowOf("scraper"), crds)).toBe(
      "/extension/freelens-addons--prometheus/monitors?name=scraper",
    );
    expect(monitorsListOf(rowOf("gateway", metrics), ["podmonitors.monitoring.coreos.com"])).toBe(
      "/extension/freelens-addons--prometheus/monitors?name=gateway",
    );
    expect(monitorsListOf(rowOf("gateway"), crds)).toBeUndefined();
    // No target allocator runs to read the monitors prometheusCR selects.
    expect(monitorsListOf(rowOf("gateway", unallocated), crds)).toBeUndefined();
    expect(
      monitorsListOf(rowOf("scraper"), ["prometheuses.monitoring.coreos.com"]),
    ).toBeUndefined();
  });

  it("opens the page the Prometheus package registers, on the param its Monitors page reads", () => {
    const prometheus = resolve(__dirname, "../../../prometheus");
    const read = (path: string) => readFileSync(resolve(prometheus, path), "utf8");
    const { name } = JSON.parse(read("package.json")) as { name: string };
    const index = read("src/renderer/index.tsx");
    const pageKey = /id: PAGES\.(\w+),(?:(?!id:)[\s\S])*<MonitorsPage/.exec(index)?.[1] ?? "";
    const pageId = new RegExp(`const PAGES = \\{[^}]*\\b${pageKey}: "([^"]+)"`).exec(index)?.[1];
    // The host's rule for an extension page route; extensions cannot import each other's ids.
    const route = `/extension/${name.replace(/^@/, "").replace("/", "--")}/${pageId}`;
    const scraper = collectorRows(collectors(), pods(), new Map(), NOW).find(
      (row) => row.name === "scraper",
    );
    if (!scraper) throw new Error("no collector scraper");
    const link = monitorsListOf(scraper, ["servicemonitors.monitoring.coreos.com"]) ?? "";
    const url = new URL(link, "http://host");
    const [param] = [...url.searchParams.keys()];

    expect(pageKey).not.toBe("");
    expect(url.pathname).toBe(route);
    expect(index).toMatch(new RegExp(`const LIST_PARAMS = \\{[^}]*\\b${param}: ""`));
    expect(read("src/renderer/pages/monitors-page.tsx")).toContain(
      `initialQuery={params?.${param}?.get()}`,
    );
  });
});

describe("a metadata-only listing", () => {
  it("keeps namespace/name of each object, and skips one without a name", () => {
    const list = podList();
    const pod = podOf("otel-late", "late");

    expect(namesFrom(list).has(`otel-late/${pod.getName()}`)).toBe(true);
    const unnamed = (list.items ?? [])
      .slice(0, 1)
      .map((item) => ({ ...item, metadata: { ...item.metadata, name: undefined } }));

    expect(namesFrom({ items: unnamed })).toEqual(new Set());
    expect(namesFrom({}).size).toBe(0);
  });

  it("keeps each namespace's outcome, so one refusal blanks no other", () => {
    const listings = settledListings(
      ["otel-late", "otel-tls", "otel-apps"],
      [
        { status: "fulfilled", value: podList() },
        { status: "rejected", reason: new Error("403 Forbidden") },
        { status: "rejected", reason: "offline" },
      ],
    );
    const pod = `otel-late/${podOf("otel-late", "late").getName()}`;

    expect(listings.get("otel-late")).toEqual(namesFrom(podList()));
    expect(namesFrom(podList()).has(pod)).toBe(true);
    expect(listings.get("otel-tls")).toEqual({ error: "403 Forbidden" });
    expect(listings.get("otel-apps")).toEqual({ error: "offline" });
    expect(settledListings(["otel-late"], []).get("otel-late")).toEqual({ error: "not listed" });
    expect(anyRefused(listings)).toBe(true);
    expect(anyRefused(new Map([["otel-tls", secretNames()]]), undefined)).toBe(false);
  });

  it("keeps the names listed before when a re-list is refused, and takes a fresh list", () => {
    const before = new Map([["otel-tls", secretNames()]]);
    const refused = new Map([["otel-tls", { error: "503" }]]);
    const fresh = new Map([["otel-tls", new Set(["otel-tls/otel-ca"])]]);

    expect(mergeListings(before, refused).get("otel-tls")).toBe(before.get("otel-tls"));
    expect(mergeListings(before, fresh).get("otel-tls")).toEqual(new Set(["otel-tls/otel-ca"]));
    expect(mergeListings(undefined, refused).get("otel-tls")).toEqual({ error: "503" });
    expect(mergeListings(refused, refused).get("otel-tls")).toEqual({ error: "503" });
    expect([...mergeListings(new Map([["otel-apps", secretNames()]]), fresh).keys()]).toEqual([
      "otel-apps",
      "otel-tls",
    ]);
  });
});
