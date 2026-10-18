import { describe, expect, it } from "vitest";
import {
  indexedRead,
  isMonitorFilter,
  lookupNamespaces,
  lookupScope,
  MONITOR_FILTERS,
  type MonitorRow,
  matchesMonitorFilter,
  monitorRows,
} from "../../src/renderer/api/monitors/monitors";
import type { PrometheusRead } from "../../src/renderer/api/monitors/scrape-pools";
import { monitorFacts } from "../../src/renderer/api/shared/facts";
import { rejectionsFrom } from "../../src/renderer/api/shared/rejections";
import { selectorSources } from "../../src/renderer/api/shared/selection";
import {
  agents,
  allocatorReads,
  collectors,
  events,
  monitorInventory,
  named,
  namespaces,
  prometheuses,
  reads,
  readsWithoutTargetsOf,
  serviceMonitors,
  sources,
  variant,
} from "../support/fixtures";

const rowOf = (rows: MonitorRow[], key: string) => {
  const found = rows.find((row) => row.key === key);

  if (!found) throw new Error(`no row ${key}`);

  return found;
};
const stateOf = (rows: MonitorRow[], key: string) => rowOf(rows, key).state;

describe("once the operator's Events expire", () => {
  it("rejected reads not loaded, still under the Rejected filter", () => {
    const row = rowOf(
      monitorRows(monitorInventory({ rejections: new Map() })),
      "ServiceMonitor/monitoring/rejected",
    );

    expect(row.state).toBe("not-loaded");
    expect(row.verdict.reason).toBe(
      "Prometheus monitoring/seed has no scrape pool for it; its Events or logs say why",
    );
    expect(matchesMonitorFilter(row, "rejected")).toBe(true);
  });
});

describe("each seeded monitor", () => {
  const rows = () => monitorRows(monitorInventory());

  it("is healthy when selected, reachable and up", () => {
    for (const key of [
      "ServiceMonitor/monitoring/prom-self",
      "ServiceMonitor/monitoring/operator",
      "ServiceMonitor/monitoring/kubelet",
      "PodMonitor/monitoring/node-exporter",
      "PodMonitor/prom-apps/prom-pods",
      "ScrapeConfig/prom-apps/static-self",
    ]) {
      expect([key, stateOf(rows(), key)]).toEqual([key, "healthy"]);
    }
    expect(rowOf(rows(), "ServiceMonitor/monitoring/kubelet").verdict.reason).toBe("2 targets up");
  });

  it("down-path is down, with Prometheus's error", () => {
    const row = rowOf(rows(), "ServiceMonitor/monitoring/down-path");

    expect(row.state).toBe("down");
    expect(row.verdict).toEqual({
      tone: "critical",
      label: "Down",
      reason: "1 of 1 target down: server returned HTTP status 404 Not Found",
    });
  });

  it("rejected carries the operator's message", () => {
    const row = rowOf(rows(), "ServiceMonitor/monitoring/rejected");

    expect(row.state).toBe("rejected");
    expect(row.verdict.reason).toMatch(/scrapeTimeout "30s" greater than scrapeInterval "10s"/);
  });

  it("orphan is not selected, and excluded sits in a namespace the seed leaves out", () => {
    expect(stateOf(rows(), "ServiceMonitor/prom-apps/orphan")).toBe("not-selected");

    const excluded = rowOf(rows(), "ServiceMonitor/prom-outside/excluded");

    expect(excluded.state).toBe("namespace-excluded");
    expect(excluded.verdict.reason).toBe(
      "Prometheus monitoring/seed selects its labels, but not namespace prom-outside",
    );
  });

  it("no-service finds no Service, wrong-port names a port it does not have", () => {
    expect(rowOf(rows(), "ServiceMonitor/prom-apps/no-service").verdict.reason).toBe(
      "No Service in prom-apps matches app=ghost",
    );
    expect(rowOf(rows(), "ServiceMonitor/prom-apps/wrong-port").verdict).toEqual({
      tone: "critical",
      label: "Port missing",
      reason: "No matched Service has a port named metrics; they have web",
    });
  });

  it("no-endpoints finds its Service and port, but no endpoint behind them", () => {
    expect(rowOf(rows(), "ServiceMonitor/prom-apps/no-endpoints").verdict).toEqual({
      tone: "warning",
      label: "No endpoints",
      reason: "prom-apps/idle has no endpoint on port web",
    });
  });

  it("otel-self has a job in the TargetAllocator, whose collector holds its health", () => {
    const row = rowOf(rows(), "ServiceMonitor/prom-apps/otel-self");

    expect(row.state).toBe("unknown");
    expect(row.health).toBeUndefined();
    expect(row.live.map((view) => [view.source.key, view.loaded])).toEqual([
      ["TargetAllocator/otel-collectors/scraper", true],
    ]);
    expect(row.verdict.reason).toBe(
      "TargetAllocator of otel-collectors/scraper has a job for it; its targets' health is in the collector",
    );
  });

  it("paused-only, taken only by the paused agent, has a source that was not read", () => {
    const row = rowOf(rows(), "ServiceMonitor/monitoring/paused-only");

    expect(row.live.map((view) => [view.source.key, view.error])).toEqual([
      ["PrometheusAgent/monitoring/agent", "PrometheusAgent monitoring/agent is paused"],
    ]);
    expect([row.state, row.verdict]).toEqual([
      "unknown",
      { tone: "info", label: "Unknown", reason: "PrometheusAgent monitoring/agent is paused" },
    ]);
  });
});

describe("without a live read", () => {
  it("a selected monitor reads unknown, never healthy", () => {
    const rows = monitorRows(monitorInventory({ reads: [] }));

    expect(stateOf(rows, "ServiceMonitor/monitoring/prom-self")).toBe("unknown");
    expect(rowOf(rows, "ServiceMonitor/monitoring/prom-self").verdict.reason).toBe(
      "Prometheus monitoring/seed has not been read",
    );
    // Kubernetes checks still decide without Prometheus.
    expect(stateOf(rows, "ServiceMonitor/prom-apps/wrong-port")).toBe("port-missing");
  });

  it("a refused proxy says why", () => {
    const rows = monitorRows(
      monitorInventory({
        reads: [{ source: "Prometheus/monitoring/seed", error: "403 Forbidden" }],
      }),
    );

    expect(rowOf(rows, "ServiceMonitor/monitoring/prom-self").verdict.reason).toBe("403 Forbidden");
  });

  it("a paused Prometheus is not asked", () => {
    const paused = prometheuses().map((each) =>
      variant(each, (data) => {
        data.spec.paused = true;
      }),
    );
    const rows = monitorRows(
      monitorInventory({ sources: selectorSources(paused, agents(), collectors()) }),
    );

    expect(rowOf(rows, "ServiceMonitor/monitoring/prom-self").verdict.reason).toBe(
      "Prometheus monitoring/seed is paused",
    );
  });
});

describe("live states made from variants", () => {
  const [seed] = reads();

  it("selected but without a scrape pool is not loaded", () => {
    const withoutTargets = monitorRows(
      monitorInventory({
        reads: seed
          ? [
              {
                ...seed,
                pools: seed.pools?.filter((pool) => !pool.includes("/prom-self/")),
                targets: seed.targets?.filter(
                  (target) => !target.scrapePool.includes("/prom-self/"),
                ),
              },
            ]
          : [],
      }),
    );

    expect(stateOf(withoutTargets, "ServiceMonitor/monitoring/prom-self")).toBe("not-loaded");
  });

  it("loaded with nothing discovered, not scraped yet, or targets not read", () => {
    const withoutStatic = seed && {
      ...seed,
      targets: seed.targets?.filter((target) => !target.scrapePool.startsWith("scrapeConfig/")),
    };
    const fresh = seed && {
      ...seed,
      targets: seed.targets?.map((target) => ({ ...target, health: "unknown" as const })),
    };
    const unread = seed && { ...seed, targets: undefined };

    expect(
      rowOf(
        monitorRows(monitorInventory({ reads: withoutStatic ? [withoutStatic] : [] })),
        "ScrapeConfig/prom-apps/static-self",
      ).verdict.reason,
    ).toBe("Prometheus loaded it but discovered no target");
    expect(
      rowOf(
        monitorRows(monitorInventory({ reads: fresh ? [fresh] : [] })),
        "ServiceMonitor/monitoring/prom-self",
      ).verdict.reason,
    ).toBe("1 target not scraped yet");
    expect(
      rowOf(
        monitorRows(monitorInventory({ reads: unread ? [unread] : [] })),
        "ServiceMonitor/monitoring/prom-self",
      ).verdict.reason,
    ).toBe("The targets were not read");
  });

  it("a Service whose pod is not ready is still scraped, so its live health decides", () => {
    const moved = serviceMonitors().map((each) =>
      each.getName() === "wrong-port"
        ? variant(each, (data) => {
            data.spec.namespaceSelector = { matchNames: ["prom-broken"] };
            for (const endpoint of data.spec.endpoints ?? []) endpoint.port = "web";
          })
        : each,
    );
    const row = rowOf(
      monitorRows(monitorInventory({ serviceMonitors: moved })),
      "ServiceMonitor/prom-apps/wrong-port",
    );

    expect(row.state).not.toBe("no-endpoints");
  });

  it("a Service with no address on the port has no endpoints", () => {
    const moved = serviceMonitors().map((each) =>
      each.getName() === "wrong-port"
        ? variant(each, (data) => {
            data.spec.namespaceSelector = { matchNames: ["prom-broken"] };
            for (const endpoint of data.spec.endpoints ?? []) endpoint.port = "web";
          })
        : each,
    );
    const empty = monitorInventory().endpointSlices.map((slice) =>
      variant(slice, (data) => {
        data.endpoints = [];
      }),
    );
    const row = rowOf(
      monitorRows(monitorInventory({ serviceMonitors: moved, endpointSlices: empty })),
      "ServiceMonitor/prom-apps/wrong-port",
    );

    expect(row.state).toBe("no-endpoints");
    expect(row.verdict.reason).toBe("prom-broken/prometheus-operated has no endpoint on port web");
  });

  it("a PodMonitor with no pod, or a port no pod names", () => {
    const rows = monitorRows(
      monitorInventory({
        podMonitors: monitorInventory().podMonitors.map((each) =>
          variant(each, (data) => {
            if (each.getName() === "prom-pods")
              data.spec.selector = { matchLabels: { app: "ghost" } };
            else data.spec.podMetricsEndpoints = [{ port: "nope" }];
          }),
        ),
        reads: readsWithoutTargetsOf("/prom-pods/"),
      }),
    );

    expect(rowOf(rows, "PodMonitor/prom-apps/prom-pods").verdict.reason).toBe(
      "No pod in monitoring matches app=ghost",
    );
    expect(rowOf(rows, "PodMonitor/monitoring/node-exporter").verdict.reason).toBe(
      "No matched pod has a port named nope; they have metrics",
    );
  });

  it("a binding that refuses it reads as rejected", () => {
    const refused = serviceMonitors().map((each) =>
      each.getName() === "prom-self"
        ? variant(each, (data) => {
            data.status = {
              bindings: [
                {
                  resource: "prometheuses",
                  name: "seed",
                  namespace: "monitoring",
                  conditions: [{ type: "Accepted", status: "False", message: "bad endpoint" }],
                },
              ],
            };
          })
        : each,
    );
    const row = rowOf(
      monitorRows(monitorInventory({ serviceMonitors: refused })),
      "ServiceMonitor/monitoring/prom-self",
    );

    expect(row.state).toBe("rejected");
    expect(row.verdict.reason).toBe("Prometheus monitoring/seed: bad endpoint");
  });

  it("names no port when the matched objects name none", () => {
    const unnamed = serviceMonitors().map((each) =>
      each.getName() === "wrong-port"
        ? variant(each, (data) => {
            data.spec.namespaceSelector = { matchNames: ["kube-system"] };
            data.spec.selector = { matchLabels: { "k8s-app": "kube-dns" } };
          })
        : each,
    );
    const row = rowOf(
      monitorRows(
        monitorInventory({
          serviceMonitors: unnamed,
          services: monitorInventory().services.map((service) =>
            variant(service, (data) => {
              for (const port of data.spec.ports ?? []) delete port.name;
            }),
          ),
        }),
      ),
      "ServiceMonitor/prom-apps/wrong-port",
    );

    expect(row.verdict.reason).toBe(
      "No matched Service has a port named metrics; they name no port",
    );
  });
});

describe("reasons in every shape", () => {
  const [seed] = reads();

  it("a monitor that looks in any namespace and finds nothing", () => {
    const anywhere = serviceMonitors().map((each) =>
      each.getName() === "no-service"
        ? variant(each, (data) => {
            data.spec.namespaceSelector = { any: true };
          })
        : each,
    );

    expect(
      rowOf(
        monitorRows(monitorInventory({ serviceMonitors: anywhere })),
        "ServiceMonitor/prom-apps/no-service",
      ).verdict.reason,
    ).toBe("No Service in any namespace matches app=ghost");
  });

  it("a PodMonitor whose pods have no IP", () => {
    const notReady = monitorInventory().podMonitors.map((each) =>
      each.getName() === "prom-pods"
        ? variant(each, (data) => {
            data.spec.namespaceSelector = { matchNames: ["prom-broken"] };
            data.spec.selector = { matchLabels: { "operator.prometheus.io/name": "no-image" } };
          })
        : each,
    );

    expect(
      rowOf(
        monitorRows(
          monitorInventory({
            podMonitors: notReady,
            reads: readsWithoutTargetsOf("/prom-pods/"),
            pods: monitorInventory().pods.map((pod) =>
              variant(pod, (data) => {
                if (data.status) delete data.status.podIP;
              }),
            ),
          }),
        ),
        "PodMonitor/prom-apps/prom-pods",
      ).verdict.reason,
    ).toBe("prom-broken/prometheus-no-image-0 has no pod IP");
  });

  it("two Services without endpoints, and a target down without an error", () => {
    const both = serviceMonitors().map((each) =>
      each.getName() === "wrong-port"
        ? variant(each, (data) => {
            data.spec.namespaceSelector = { any: true };
            data.spec.selector = { matchLabels: { "operated-prometheus": "true" } };
            for (const endpoint of data.spec.endpoints ?? []) endpoint.port = "web";
          })
        : each,
    );
    const slices = monitorInventory().endpointSlices.map((slice) =>
      variant(slice, (data) => {
        data.endpoints = [];
      }),
    );
    const silent = seed && {
      ...seed,
      targets: seed.targets?.map((target) => ({ ...target, lastError: "" })),
    };

    expect(
      rowOf(
        monitorRows(monitorInventory({ serviceMonitors: both, endpointSlices: slices })),
        "ServiceMonitor/prom-apps/wrong-port",
      ).verdict.reason,
    ).toBe(
      "monitoring/prometheus-operated, prom-broken/prometheus-operated have no endpoint on port web",
    );
    expect(
      rowOf(
        monitorRows(monitorInventory({ reads: silent ? [silent] : [] })),
        "ServiceMonitor/monitoring/down-path",
      ).verdict.reason,
    ).toBe("1 of 1 target down");
  });
});

describe("filters", () => {
  it("keep the states each chip names", () => {
    const rows = monitorRows(monitorInventory());
    const count = (filter: (typeof MONITOR_FILTERS)[number]) =>
      rows.filter((row) => matchesMonitorFilter(row, filter)).length;

    expect(MONITOR_FILTERS.map((filter) => [filter, count(filter)])).toEqual([
      ["attention", 7],
      ["not-selected", 2],
      ["no-target", 3],
      ["down", 1],
      ["rejected", 1],
      ["healthy", 6],
      ["unknown", 2],
    ]);
    expect(rows.every((row) => matchesMonitorFilter(row, undefined))).toBe(true);
    expect(isMonitorFilter("down")).toBe(true);
    expect(isMonitorFilter("sideways")).toBe(false);
    expect(isMonitorFilter(undefined)).toBe(false);
  });
});

describe("where the checks look", () => {
  it("each monitor's target namespaces and each source's own", () => {
    const sources = selectorSources(prometheuses(), agents(), collectors());

    expect(lookupNamespaces(serviceMonitors(), sources, ["a", "b"])).toEqual([
      "kube-system",
      "monitoring",
      "otel-collectors",
      "prom-apps",
      "prom-broken",
      "prometheus-operator",
    ]);
    expect(lookupNamespaces([], [], ["a"])).toEqual([]);

    const anywhere = variant(named(serviceMonitors(), "monitoring/prom-self"), (data) => {
      data.spec.namespaceSelector = { any: true };
    });

    expect(lookupNamespaces([anywhere], [], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("adds the monitor's own namespace when a source ignores namespace selectors", () => {
    const ignoring = selectorSources(
      [
        variant(named(prometheuses(), "monitoring/seed"), (data) => {
          data.spec.ignoreNamespaceSelectors = true;
        }),
      ],
      [],
      [],
    );

    expect(
      lookupNamespaces([named(serviceMonitors(), "prom-apps/wrong-port")], ignoring, []),
    ).toEqual(["monitoring", "prom-apps"]);
  });
});

describe("ignoreNamespaceSelectors, per source", () => {
  const seed = named(prometheuses(), "monitoring/seed");
  const ignoring = variant(seed, (data) => {
    data.metadata.name = "home-only";
    data.spec.ignoreNamespaceSelectors = true;
  });
  const kubeletOf = (instances: ReturnType<typeof prometheuses>) =>
    rowOf(
      monitorRows(monitorInventory({ sources: selectorSources(instances, [], collectors()) })),
      "ServiceMonitor/monitoring/kubelet",
    );

  it("keeps the monitor home when its only source ignores them, and says so", () => {
    const row = kubeletOf([ignoring]);

    expect(row.looksIn).toEqual({ any: false, names: ["monitoring"] });
    expect(row.state).toBe("no-target");
    expect(row.verdict.reason).toMatch(/^No Service in monitoring matches /);
    expect(monitorFacts(row).find((fact) => fact.term === "Looks in")?.value).toBe("monitoring");
  });

  it("looks where any other selecting source looks", () => {
    const row = kubeletOf([seed, ignoring]);

    expect(row.looksIn).toEqual({ any: false, names: ["kube-system", "monitoring"] });
    expect(row.checks.map((check) => check.state)).toEqual(["ok", "ok"]);
  });
});

describe("a monitor only a TargetAllocator takes", () => {
  const otelSelf = (allocator: PrometheusRead[]) =>
    rowOf(
      monitorRows(monitorInventory({ reads: [...reads().slice(0, 1), ...allocator] })),
      "ServiceMonitor/prom-apps/otel-self",
    );

  it("is not loaded when the TargetAllocator has no job for it", () => {
    const row = otelSelf(
      allocatorReads().map((read) => ({
        ...read,
        pools: read.pools?.filter((pool) => !pool.includes("/otel-self/")),
      })),
    );

    expect(row.state).toBe("not-loaded");
    expect(row.verdict.reason).toBe(
      "TargetAllocator of otel-collectors/scraper has no job for it, so it was not loaded or discovered nothing; its Events or logs say why",
    );
    expect(matchesMonitorFilter(row, "rejected")).toBe(true);
  });

  it("is unknown when the TargetAllocator could not be read, or has not been", () => {
    expect(
      otelSelf(allocatorReads().map((read) => ({ source: read.source, error: "403 Forbidden" })))
        .verdict.reason,
    ).toBe("403 Forbidden");
    expect(otelSelf([]).verdict.reason).toBe(
      "TargetAllocator of otel-collectors/scraper has not been read",
    );
  });

  it("names both kinds of source when neither loaded it", () => {
    const both = selectorSources(
      [
        variant(named(prometheuses(), "monitoring/seed"), (data) => {
          data.spec.serviceMonitorSelector = {};
          data.spec.serviceMonitorNamespaceSelector = {};
        }),
      ],
      [],
      collectors(),
    );
    const [seed] = reads();
    const row = rowOf(
      monitorRows(
        monitorInventory({
          sources: both,
          reads: [
            ...(seed ? [seed] : []),
            ...allocatorReads().map((read) => ({ ...read, pools: [] })),
          ],
        }),
      ),
      "ServiceMonitor/prom-apps/otel-self",
    );

    expect(row.verdict.reason).toBe(
      "Prometheus monitoring/seed has no scrape pool for it; TargetAllocator of otel-collectors/scraper has no job for it, so it was not loaded or discovered nothing; its Events or logs say why",
    );
  });
});

describe("an InvalidConfiguration Event that no longer holds", () => {
  const [seed] = reads();
  const rejected = (change: Parameters<typeof monitorInventory>[0]) =>
    rowOf(monitorRows(monitorInventory(change)), "ServiceMonitor/monitoring/rejected");

  it("is about an earlier object of the same name when its uid differs", () => {
    const recreated = events().map((event) => ({
      ...event,
      involvedObject: { ...event.involvedObject, uid: "00000000-0000-0000-0000-000000000000" },
    }));
    const row = rejected({ rejections: rejectionsFrom(recreated) });

    expect(row.rejection).toBeUndefined();
    expect(row.state).toBe("not-loaded");
  });

  it("is outrun by a scrape pool: the fix was loaded", () => {
    const fixed = seed && {
      ...seed,
      pools: [...(seed.pools ?? []), "serviceMonitor/monitoring/rejected/0"],
    };
    const row = rejected({ reads: fixed ? [fixed] : [] });

    expect(row.rejection).toBeUndefined();
    expect(row.state).not.toBe("rejected");
  });

  it("holds though a TargetAllocator has a job for it: it does not apply the operator's checks", () => {
    const otelSelf = named(serviceMonitors(), "prom-apps/otel-self");
    const aboutOtelSelf = events().map((event) => ({
      ...event,
      involvedObject: {
        ...event.involvedObject,
        namespace: "prom-apps",
        name: "otel-self",
        uid: otelSelf.metadata.uid,
      },
    }));
    const row = rowOf(
      monitorRows(monitorInventory({ rejections: rejectionsFrom(aboutOtelSelf) })),
      "ServiceMonitor/prom-apps/otel-self",
    );

    expect(row.live.map((view) => view.loaded)).toEqual([true]);
    expect(row.state).toBe("rejected");
  });

  it("still holds without a uid on either side", () => {
    const bare = events().map((event) => ({
      ...event,
      involvedObject: { ...event.involvedObject, uid: undefined },
    }));

    expect(rejected({ rejections: rejectionsFrom(bare) }).state).toBe("rejected");
  });
});

describe("live targets against the Kubernetes checks", () => {
  const [seed] = reads();
  // prom-self's real target, moved to another monitor's pool.
  const withTarget = (pool: string, key: string, health: "up" | "down" = "up") => {
    const target = seed?.targets?.find((each) => each.scrapePool.includes("/prom-self/"));
    const moved =
      seed && target
        ? [{ ...seed, targets: [...(seed.targets ?? []), { ...target, scrapePool: pool, health }] }]
        : [];

    return rowOf(monitorRows(monitorInventory({ reads: moved })), key);
  };
  const noEndpoints = "ServiceMonitor/prom-apps/no-endpoints";

  it("a target up wins over No endpoints, with a note", () => {
    const row = withTarget("serviceMonitor/prom-apps/no-endpoints/0", noEndpoints);

    expect(row.state).toBe("healthy");
    expect(row.verdict.reason).toBe(
      "1 target up, though the Kubernetes check finds nothing to scrape; the lists it read may be behind",
    );
  });

  it("a target up wins over No target", () => {
    expect(
      withTarget("serviceMonitor/prom-apps/no-service/0", "ServiceMonitor/prom-apps/no-service")
        .state,
    ).toBe("healthy");
  });

  it("only on the endpoint whose target is up", () => {
    expect(withTarget("serviceMonitor/prom-apps/no-endpoints/1", noEndpoints).state).toBe(
      "no-endpoints",
    );
  });

  it("a target down is not enough, and a missing port is not outrun", () => {
    expect(withTarget("serviceMonitor/prom-apps/no-endpoints/0", noEndpoints, "down").state).toBe(
      "no-endpoints",
    );
    expect(
      withTarget("serviceMonitor/prom-apps/wrong-port/0", "ServiceMonitor/prom-apps/wrong-port")
        .state,
    ).toBe("port-missing");
  });

  it("no check runs while the Kubernetes lists hold another scope's objects", () => {
    const row = rowOf(
      monitorRows(monitorInventory({ targetsLoaded: false })),
      "ServiceMonitor/prom-apps/no-service",
    );

    expect(row.checks).toEqual([]);
    expect(row.state).toBe("no-target");
    expect(row.verdict.reason).toBe("Prometheus loaded it but discovered no target");
  });
});

describe("rows built once per call", () => {
  it("group the Kubernetes lists once, not once per monitor", () => {
    const inventory = monitorInventory();
    const services = inventory.services;
    let asked = 0;

    Object.defineProperty(inventory, "services", {
      get: () => {
        asked += 1;

        return services;
      },
    });

    const checked = monitorRows(inventory).filter((row) => row.checks.length > 0);

    expect(checked.length).toBeGreaterThan(1);
    expect(asked).toBe(1);
  });

  it("index each live read once, until its source answers again", () => {
    const [seed] = reads();
    const indexed = seed && indexedRead(seed);

    expect(seed && indexedRead(seed)).toBe(indexed);
    expect(indexed?.loaded?.has("ServiceMonitor/monitoring/prom-self")).toBe(true);
    expect(seed && indexedRead({ ...seed })).not.toBe(indexed);
  });
});

describe("where the Kubernetes lists are loaded", () => {
  const every = namespaces()
    .map((each) => each.getName())
    .sort();

  it("in the few namespaces the monitors look in", () => {
    const lookup = lookupNamespaces(serviceMonitors(), sources(), every);

    expect(lookup.length * 2).toBeLessThan(every.length);
    expect(lookupScope(lookup, every)).toEqual(lookup);
    expect(lookupScope([], every)).toEqual([]);
  });

  it("in every namespace once a monitor looks anywhere, or half of them are asked", () => {
    const anywhere = variant(named(serviceMonitors(), "monitoring/prom-self"), (data) => {
      data.spec.namespaceSelector = { any: true };
    });
    const half = every.slice(0, Math.ceil(every.length / 2));

    expect(lookupScope(lookupNamespaces([anywhere], sources(), every), every)).toEqual(every);
    expect(lookupScope(half, every)).toEqual(every);
    expect(lookupScope(half.slice(1), every)).toEqual(half.slice(1));
  });

  it("in every namespace past 20, however many the cluster has", () => {
    const large = [...every, ...every.map((name) => `${name}-2`)].sort();

    expect(lookupScope(every.slice(0, 20), large)).toEqual(every.slice(0, 20));
    expect(lookupScope(every.slice(0, 21), large)).toEqual(large);
  });

  it("keeps a namespace the monitors name that the list does not hold", () => {
    expect(lookupScope([...every, "prom-gone"], every)).toEqual([...every, "prom-gone"].sort());
  });
});
