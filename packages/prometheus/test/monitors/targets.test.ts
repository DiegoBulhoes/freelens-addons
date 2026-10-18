import { describe, expect, it } from "vitest";
import {
  endpointCounts,
  indexObjects,
  kubernetesChecks,
  portNameFound,
  worstCheck,
} from "../../src/renderer/api/monitors/targets";
import {
  inTargetNamespaces,
  matchesSelector,
  monitorTargetNamespaces,
  namespaceOf,
} from "../../src/renderer/api/shared/selectors";
import {
  endpointSlices,
  named,
  podMonitors,
  pods,
  scrapeConfigs,
  serviceMonitors,
  services,
  variant,
} from "../support/fixtures";

const objects = () => ({ services: services(), endpointSlices: endpointSlices(), pods: pods() });
const keys = (list: { getNs(): string | undefined; getName(): string }[]) =>
  list.map((each) => `${each.getNs()}/${each.getName()}`);
const monitor = (key: string) => named(serviceMonitors(), key);

describe("ports and endpoints", () => {
  it("wrong-port names a port the Service does not have", () => {
    const service = named(services(), "monitoring/prometheus-operated");

    expect(portNameFound(service, "web")).toBe(true);
    expect(portNameFound(service, "metrics")).toBe(false);
  });

  it("counts every address from the Service's EndpointSlices, and the ready ones apart", () => {
    expect(
      endpointCounts(endpointSlices(), named(services(), "monitoring/prometheus-operated"), "web"),
    ).toEqual({ addresses: 1, ready: 1 });
    // no-image's pod never got its image, yet Prometheus still scrapes its address.
    expect(
      endpointCounts(endpointSlices(), named(services(), "prom-broken/prometheus-operated"), "web"),
    ).toEqual({ addresses: 1, ready: 0 });
    expect(
      endpointCounts(
        endpointSlices(),
        named(services(), "monitoring/prometheus-operated"),
        "metrics",
      ),
    ).toEqual({ addresses: 0, ready: 0 });
  });

  it("takes an endpoint without a ready condition as ready, as Kubernetes does", () => {
    const slices = endpointSlices().map((slice) =>
      slice.getName().startsWith("kubelet-")
        ? variant(slice, (data) => {
            for (const endpoint of data.endpoints ?? []) delete endpoint.conditions;
          })
        : slice,
    );

    expect(
      endpointCounts(slices, named(services(), "kube-system/kubelet"), "https-metrics").ready,
    ).toBe(1);
  });
});

describe("checks per endpoint", () => {
  it("prom-self and both kubelet endpoints are ready", () => {
    expect(kubernetesChecks("ServiceMonitor", monitor("monitoring/prom-self"), objects())).toEqual([
      {
        index: 0,
        port: "web",
        targets: ["monitoring/prometheus-operated"],
        portNames: ["web"],
        withPort: ["monitoring/prometheus-operated"],
        addresses: 1,
        ready: 1,
        state: "ok",
      },
    ]);
    expect(
      kubernetesChecks("ServiceMonitor", monitor("monitoring/kubelet"), objects()).map(
        (each) => each.state,
      ),
    ).toEqual(["ok", "ok"]);
  });

  it("no-service has no target, wrong-port a missing port", () => {
    expect(
      worstCheck(kubernetesChecks("ServiceMonitor", monitor("prom-apps/no-service"), objects()))
        ?.state,
    ).toBe("no-target");

    const wrong = worstCheck(
      kubernetesChecks("ServiceMonitor", monitor("prom-apps/wrong-port"), objects()),
    );

    expect(wrong?.state).toBe("port-missing");
    expect(wrong?.portNames).toEqual(["web"]);
  });

  it("a Service whose only pod is not ready still has a target, which Prometheus scrapes", () => {
    const broken = variant(monitor("prom-apps/wrong-port"), (data) => {
      data.spec.namespaceSelector = { matchNames: ["prom-broken"] };
      for (const endpoint of data.spec.endpoints ?? []) endpoint.port = "web";
    });

    expect(worstCheck(kubernetesChecks("ServiceMonitor", broken, objects()))).toMatchObject({
      addresses: 1,
      ready: 0,
      state: "ok",
    });
  });

  it("an endpoint that names only a targetPort is not checked", () => {
    const byTarget = variant(monitor("monitoring/prom-self"), (data) => {
      data.spec.endpoints = [{ targetPort: 9090 }];
    });

    expect(kubernetesChecks("ServiceMonitor", byTarget, objects())[0]?.state).toBe("unchecked");
  });

  it("prom-pods reaches the seed's pod and its web port", () => {
    const [check] = kubernetesChecks(
      "PodMonitor",
      named(podMonitors(), "prom-apps/prom-pods"),
      objects(),
    );

    expect(check).toMatchObject({
      targets: ["monitoring/prometheus-seed-0"],
      withPort: ["monitoring/prometheus-seed-0"],
      addresses: 1,
      ready: 1,
      state: "ok",
    });
    expect(check?.portNames).toEqual(["web", "reloader-web"]);
  });

  it("a native sidecar's port counts; a plain init container's does not", () => {
    const pm = variant(named(podMonitors(), "prom-apps/prom-pods"), (data) => {
      data.spec.podMetricsEndpoints = [{ port: "reloader-init" }];
    });
    const sidecar = pods().map((pod) =>
      variant(pod, (data) => {
        for (const init of data.spec?.initContainers ?? []) init.restartPolicy = "Always";
      }),
    );

    expect(kubernetesChecks("PodMonitor", pm, objects())[0]?.state).toBe("port-missing");
    expect(kubernetesChecks("PodMonitor", pm, { ...objects(), pods: sidecar })[0]).toMatchObject({
      portNames: ["web", "reloader-web", "reloader-init"],
      withPort: ["monitoring/prometheus-seed-0"],
      state: "ok",
    });
  });

  it("a PodMonitor port found by number, missing, on a pod not ready, or on one without an IP", () => {
    const pm = named(podMonitors(), "prom-apps/prom-pods");
    const byNumber = variant(pm, (data) => {
      data.spec.podMetricsEndpoints = [{ portNumber: 9090 }];
    });
    const missing = variant(pm, (data) => {
      data.spec.podMetricsEndpoints = [{ port: "metrics" }];
    });
    const notReady = variant(pm, (data) => {
      data.spec.namespaceSelector = { matchNames: ["prom-broken"] };
      data.spec.selector = { matchLabels: { "operator.prometheus.io/name": "no-image" } };
    });
    const none = variant(pm, (data) => {
      data.spec.podMetricsEndpoints = [{}];
    });
    const noIp = pods().map((pod) =>
      variant(pod, (data) => {
        if (data.status) delete data.status.podIP;
      }),
    );

    expect(kubernetesChecks("PodMonitor", byNumber, objects())[0]).toMatchObject({
      port: "9090",
      state: "ok",
    });
    expect(kubernetesChecks("PodMonitor", missing, objects())[0]?.state).toBe("port-missing");
    expect(kubernetesChecks("PodMonitor", notReady, objects())[0]).toMatchObject({
      addresses: 1,
      ready: 0,
      state: "ok",
    });
    expect(kubernetesChecks("PodMonitor", notReady, { ...objects(), pods: noIp })[0]?.state).toBe(
      "no-endpoints",
    );
    expect(kubernetesChecks("PodMonitor", none, objects())[0]?.state).toBe("unchecked");
  });

  it("leaves out pods that ended, as the operator's relabelling does", () => {
    const pm = named(podMonitors(), "prom-apps/prom-pods");
    const ended = pods().map((pod) =>
      pod.getName() === "prometheus-seed-0"
        ? variant(pod, (data) => {
            if (data.status) data.status.phase = "Succeeded";
          })
        : pod,
    );

    expect(kubernetesChecks("PodMonitor", pm, { ...objects(), pods: ended })[0]?.state).toBe(
      "no-target",
    );
  });

  it("keeps pods that ended when the endpoint sets filterRunning: false", () => {
    const pm = variant(named(podMonitors(), "prom-apps/prom-pods"), (data) => {
      for (const endpoint of data.spec.podMetricsEndpoints ?? []) endpoint.filterRunning = false;
    });
    const ended = pods().map((pod) =>
      pod.getName() === "prometheus-seed-0"
        ? variant(pod, (data) => {
            if (data.status) data.status.phase = "Succeeded";
          })
        : pod,
    );

    expect(kubernetesChecks("PodMonitor", pm, { ...objects(), pods: ended })[0]).toMatchObject({
      addresses: 1,
      state: "ok",
    });
  });

  it("checks a PodMonitor only where its sources look", () => {
    const [check] = kubernetesChecks(
      "PodMonitor",
      named(podMonitors(), "prom-apps/prom-pods"),
      objects(),
      { any: false, names: ["prom-apps"] },
    );

    expect(check?.state).toBe("no-target");
    expect(check?.targets).toEqual([]);
  });

  it("objects with their lists left out read as empty", () => {
    const portless = services().map((service) =>
      variant(service, (data) => {
        delete data.spec.ports;
      }),
    );
    const hollowSlices = endpointSlices().map((slice) =>
      variant(slice, (data) => {
        delete data.ports;
        delete data.endpoints;
      }),
    );
    const emptySlices = endpointSlices().map((slice) =>
      variant(slice, (data) => {
        delete data.endpoints;
      }),
    );
    const bare = pods().map((pod) =>
      variant(pod, (data) => {
        delete data.spec;
        delete data.status;
      }),
    );
    const unnamedPorts = pods().map((pod) =>
      variant(pod, (data) => {
        for (const port of (data.spec?.containers ?? []).flatMap((each) => each.ports ?? []))
          delete port.name;
      }),
    );
    const self = monitor("monitoring/prom-self");
    const pm = named(podMonitors(), "prom-apps/prom-pods");

    expect(
      kubernetesChecks("ServiceMonitor", self, { ...objects(), services: portless })[0],
    ).toMatchObject({
      portNames: [],
      state: "port-missing",
    });
    expect(
      kubernetesChecks("ServiceMonitor", self, { ...objects(), endpointSlices: hollowSlices })[0]
        ?.state,
    ).toBe("no-endpoints");
    expect(
      kubernetesChecks("ServiceMonitor", self, { ...objects(), endpointSlices: emptySlices })[0]
        ?.ready,
    ).toBe(0);
    expect(kubernetesChecks("PodMonitor", pm, { ...objects(), pods: bare })[0]?.state).toBe(
      "port-missing",
    );
    expect(
      kubernetesChecks("PodMonitor", pm, { ...objects(), pods: unnamedPorts })[0]?.portNames,
    ).toEqual([]);
    expect(
      kubernetesChecks(
        "ServiceMonitor",
        variant(self, (data) => {
          delete data.spec.endpoints;
        }),
        objects(),
      ),
    ).toEqual([]);
    expect(
      kubernetesChecks(
        "PodMonitor",
        variant(pm, (data) => {
          delete data.spec.podMetricsEndpoints;
        }),
        objects(),
      ),
    ).toEqual([]);
  });

  it("a ScrapeConfig names its targets itself, so it has no check", () => {
    expect(
      kubernetesChecks("ScrapeConfig", named(scrapeConfigs(), "prom-apps/static-self"), objects()),
    ).toEqual([]);
    expect(worstCheck([])).toBeUndefined();
  });
});

describe("the Kubernetes lists, grouped once", () => {
  const index = indexObjects(objects());
  const targetsOf = (key: string) =>
    kubernetesChecks("ServiceMonitor", monitor(key), objects(), undefined, index)[0]?.targets;

  it("prom-self reaches only the seed's governing Service, in its own namespace", () => {
    expect(targetsOf("monitoring/prom-self")).toEqual(["monitoring/prometheus-operated"]);
  });

  it("kubelet looks in kube-system, as its matchNames say", () => {
    expect(targetsOf("monitoring/kubelet")).toEqual(["kube-system/kubelet"]);
  });

  it("no-service matches no Service", () => {
    expect(targetsOf("prom-apps/no-service")).toEqual([]);
  });
  const within = (names: string[]) => (each: { getNs(): string | undefined }) =>
    names.includes(each.getNs() ?? "");

  it("give the Services and pods of the namespaces asked, in list order", () => {
    expect(keys(index.servicesIn({ any: false, names: ["monitoring"] }))).toEqual([
      "monitoring/alertmanager-operated",
      "monitoring/prometheus-operated",
    ]);
    expect(
      keys(index.podsIn({ any: false, names: ["prom-broken", "kube-system", "kube-system"] })),
    ).toEqual(keys(pods().filter(within(["prom-broken", "kube-system"]))));
    expect(index.servicesIn({ any: true })).toHaveLength(services().length);
    expect(index.podsIn({ any: false, names: ["prom-outside"] })).toEqual([]);
  });

  it("give a Service's EndpointSlices by its service-name label", () => {
    const operated = named(services(), "monitoring/prometheus-operated");
    const [slice] = index.slicesOf(operated);
    const unlabelled = slice
      ? variant(slice, (data) => {
          delete data.metadata.labels?.["kubernetes.io/service-name"];
        })
      : undefined;

    expect(index.slicesOf(operated).map((each) => each.getName())).toEqual([
      "prometheus-operated-422r7",
    ]);
    expect(
      indexObjects({ ...objects(), endpointSlices: unlabelled ? [unlabelled] : [] }).slicesOf(
        operated,
      ),
    ).toEqual([]);
  });

  it("reach the same Services as a filter over the whole list", () => {
    for (const each of serviceMonitors()) {
      const namespaces = monitorTargetNamespaces(each.spec.namespaceSelector, namespaceOf(each));
      const expected = keys(
        services().filter(
          (service) =>
            inTargetNamespaces(namespaces, namespaceOf(service)) &&
            matchesSelector(each.spec.selector, service.metadata.labels),
        ),
      );

      for (const check of kubernetesChecks("ServiceMonitor", each, objects(), undefined, index)) {
        expect(check.targets).toEqual(expected);
      }
    }
  });

  it("with ignoreNamespaceSelectors, kubelet stays home and finds nothing", () => {
    const checks = kubernetesChecks(
      "ServiceMonitor",
      monitor("monitoring/kubelet"),
      objects(),
      { any: false, names: ["monitoring"] },
      index,
    );

    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) expect(check.targets).toEqual([]);
  });
});
