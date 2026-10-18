import { describe, expect, it } from "vitest";

import {
  allowedByLists,
  describeSelector,
  inTargetNamespaces,
  matchesSelector,
  monitorLooksIn,
  monitorTargetNamespaces,
  namespaceMatches,
  namespaceOf,
} from "../../src/renderer/api/shared/selectors";
import {
  collectors,
  named,
  namespaces,
  nodes,
  prometheuses,
  serviceMonitors,
} from "../support/fixtures";

const labelsOf = (name: string) => named(namespaces(), `/${name}`).metadata.labels;
const seed = () => named(prometheuses(), "monitoring/seed").spec;
const scraper = () => named(collectors(), "otel-collectors/scraper").spec.targetAllocator;

describe("label selectors", () => {
  it("select nothing when unset and everything when empty", () => {
    const orphan = named(serviceMonitors(), "prom-apps/orphan").metadata.labels;

    // The scraper TargetAllocator leaves its ScrapeConfig selector unset.
    expect(matchesSelector(scraper()?.prometheusCR?.scrapeConfigSelector, orphan)).toBe(false);
    expect(matchesSelector(null, orphan)).toBe(false);
    expect(matchesSelector(scraper()?.prometheusCR?.serviceMonitorNamespaceSelector, orphan)).toBe(
      true,
    );
  });

  it("match on every matchLabels entry", () => {
    const selector = seed().serviceMonitorSelector;

    expect(
      matchesSelector(selector, named(serviceMonitors(), "monitoring/prom-self").metadata.labels),
    ).toBe(true);
    expect(
      matchesSelector(selector, named(serviceMonitors(), "prom-apps/orphan").metadata.labels),
    ).toBe(false);
    expect(matchesSelector(selector, undefined)).toBe(false);
  });

  it("apply each expression operator, ANDed with matchLabels", () => {
    const labels = labelsOf("monitoring");
    const key = "seed.freelens/prometheus";

    expect(
      matchesSelector({ matchExpressions: [{ key, operator: "In", values: ["true"] }] }, labels),
    ).toBe(true);
    expect(
      matchesSelector({ matchExpressions: [{ key, operator: "In", values: ["false"] }] }, labels),
    ).toBe(false);
    expect(
      matchesSelector({ matchExpressions: [{ key, operator: "In" }] }, labelsOf("prom-outside")),
    ).toBe(false);
    expect(
      matchesSelector({ matchExpressions: [{ key, operator: "NotIn", values: ["true"] }] }, labels),
    ).toBe(false);
    expect(
      matchesSelector(
        { matchExpressions: [{ key, operator: "NotIn", values: ["true"] }] },
        labelsOf("prom-outside"),
      ),
    ).toBe(true);
    expect(matchesSelector({ matchExpressions: [{ key, operator: "Exists" }] }, labels)).toBe(true);
    expect(matchesSelector({ matchExpressions: [{ key, operator: "DoesNotExist" }] }, labels)).toBe(
      false,
    );
    expect(
      matchesSelector({ matchExpressions: [{ key, operator: "Gt", values: ["1"] }] }, labels),
    ).toBe(false);
    expect(
      matchesSelector(
        {
          ...seed().serviceMonitorNamespaceSelector,
          matchExpressions: [
            { key: "kubernetes.io/metadata.name", operator: "In", values: ["prom-apps"] },
          ],
        },
        labels,
      ),
    ).toBe(false);
  });
});

describe("namespace selectors", () => {
  it("take only the owner's namespace when unset", () => {
    // The paused agent sets no namespace selector.
    expect(namespaceMatches(undefined, "monitoring", "monitoring", labelsOf("monitoring"))).toBe(
      true,
    );
    expect(namespaceMatches(null, "prom-apps", "monitoring", labelsOf("prom-apps"))).toBe(false);
  });

  it("match the namespace's labels otherwise", () => {
    const selector = seed().serviceMonitorNamespaceSelector;

    expect(namespaceMatches(selector, "prom-apps", "monitoring", labelsOf("prom-apps"))).toBe(true);
    expect(namespaceMatches(selector, "prom-outside", "monitoring", labelsOf("prom-outside"))).toBe(
      false,
    );
    expect(namespaceMatches({}, "prom-outside", "otel-collectors", labelsOf("prom-outside"))).toBe(
      true,
    );
  });

  it("keep a TargetAllocator inside its allow and deny lists", () => {
    expect(allowedByLists("prom-apps", undefined, undefined)).toBe(true);
    expect(allowedByLists("prom-apps", [], [])).toBe(true);
    expect(allowedByLists("prom-apps", ["monitoring"], undefined)).toBe(false);
    expect(allowedByLists("monitoring", ["monitoring"], undefined)).toBe(true);
    expect(allowedByLists("prom-apps", undefined, ["prom-apps"])).toBe(false);
  });
});

describe("where a monitor looks", () => {
  it("in its matchNames, its own namespace, or everywhere", () => {
    const kubelet = named(serviceMonitors(), "monitoring/kubelet");
    const self = named(serviceMonitors(), "monitoring/prom-self");

    expect(monitorTargetNamespaces(kubelet.spec.namespaceSelector, "monitoring")).toEqual({
      any: false,
      names: ["kube-system"],
    });
    expect(monitorTargetNamespaces(self.spec.namespaceSelector, "monitoring")).toEqual({
      any: false,
      names: ["monitoring"],
    });
    expect(monitorTargetNamespaces({ any: true }, "monitoring")).toEqual({ any: true });
    expect(inTargetNamespaces({ any: true }, "anything")).toBe(true);
    expect(inTargetNamespaces({ any: false, names: ["kube-system"] }, "monitoring")).toBe(false);
  });

  it("only at home when the owner ignores namespace selectors", () => {
    const kubelet = named(serviceMonitors(), "monitoring/kubelet");

    expect(monitorTargetNamespaces(kubelet.spec.namespaceSelector, "monitoring", true)).toEqual({
      any: false,
      names: ["monitoring"],
    });
  });

  it("over several sources, the union of where each one looks", () => {
    const kubelet = named(serviceMonitors(), "monitoring/kubelet").spec.namespaceSelector;

    expect(monitorLooksIn(kubelet, "monitoring", [])).toEqual({
      any: false,
      names: ["kube-system"],
    });
    expect(monitorLooksIn(kubelet, "monitoring", [true, false])).toEqual({
      any: false,
      names: ["monitoring", "kube-system"],
    });
    expect(monitorLooksIn({ any: true }, "monitoring", [true, false])).toEqual({ any: true });
  });
});

describe("namespaces of objects", () => {
  it("a cluster-scoped node has none", () => {
    expect(namespaceOf(named(nodes(), "/freelens-addons-dev"))).toBe("");
    expect(namespaceOf(named(serviceMonitors(), "monitoring/prom-self"))).toBe("monitoring");
  });
});

describe("describing a selector", () => {
  it("as kubectl -l reads", () => {
    expect(describeSelector(seed().serviceMonitorSelector)).toBe("scraper=prometheus");
    expect(describeSelector({})).toBe("everything");
    expect(describeSelector(undefined)).toBe("nothing");
    expect(
      describeSelector({
        matchExpressions: [
          { key: "a", operator: "In", values: ["x", "y"] },
          { key: "b", operator: "NotIn", values: ["z"] },
          { key: "c", operator: "Exists" },
          { key: "d", operator: "DoesNotExist" },
        ],
      }),
    ).toBe("a in (x,y), b notin (z), c, !d");
  });
});
