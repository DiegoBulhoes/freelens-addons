import { describe, expect, it } from "vitest";

import {
  COMMON_CONTAINER_NAMES,
  PREFIX,
  PYTHON_PLATFORM,
} from "../../src/renderer/api/coverage/annotations";
import { SIDECAR_INJECT, tlsBlockers } from "../../src/renderer/api/coverage/blockers";
import {
  COVERAGE_FILTERS,
  type CoverageInventory,
  type CoverageRow,
  coverageLoadState,
  coverageRows,
  FILTER_LABELS,
  FILTER_TITLES,
  filterOf,
  lookupNamespaces,
  matchesFilter,
  tally,
  withReferences,
} from "../../src/renderer/api/coverage/coverage";
import { keyOf } from "../../src/renderer/api/coverage/resolve";
import type { PodLike, PodTemplate, WorkloadLike } from "../../src/renderer/api/shared/types";
import {
  coverageInventory,
  instrumentationNamed,
  instrumentations,
  listingsOf,
  namespaces,
  operatorWith,
  podOf,
  pods,
  secretNames,
  variant,
  workloadNamed,
} from "../support/fixtures";

const PYTHON = `${PREFIX}inject-python`;

/** late, the seed's Restart needed Deployment, with these added to its pod template. */
const lateAnnotated = (annotations: Record<string, string>, inventory = coverageInventory()) => {
  const late = variant(workloadNamed("otel-late/late"), (data) => {
    data.spec.template.metadata = {
      ...data.spec.template.metadata,
      annotations: { ...data.spec.template.metadata?.annotations, ...annotations },
    };
  });

  return rowOf("otel-late/late", { ...inventory, workloads: [late] });
};

const rows = (inventory: CoverageInventory = coverageInventory()) => coverageRows(inventory);
const rowOf = (key: string, inventory?: CoverageInventory): CoverageRow => {
  const found = rows(inventory).find((row) => `${row.namespace}/${row.name}` === key);

  if (!found) throw new Error(`no row for ${key}`);

  return found;
};

const withTls = (key: string, tls: { secretName?: string; configMapName?: string }) =>
  instrumentations().map((each) =>
    keyOf(each) === key
      ? variant(each, (data) => {
          data.spec.exporter = { ...data.spec.exporter, tls };
        })
      : each,
  );

describe("the Coverage rows", () => {
  it("gives each seeded workload its state, worst first, and none to the rest", () => {
    expect(rows().map((row) => [row.kind, `${row.namespace}/${row.name}`, row.state])).toEqual([
      ["Deployment", "otel-apps/typo", "no-instrumentation"],
      ["Job", "otel-batch/migrate", "no-instrumentation"],
      ["Deployment", "otel-orphan/orphan", "no-instrumentation"],
      ["Deployment", "otel-ambiguous/ambiguous", "ambiguous"],
      ["Deployment", "otel-apps/misplaced", "misplaced"],
      ["Deployment", "otel-blocked/go-service", "blocked"],
      ["Deployment", "otel-blocked/polyglot", "blocked"],
      ["Deployment", "otel-tls/secure", "blocked"],
      ["Deployment", "otel-late/late", "restart-needed"],
      ["DaemonSet", "otel-late/late-agent", "restart-needed"],
      ["Deployment", "otel-namespace/opted-out", "opted-out"],
      ["Deployment", "otel-apps/checkout", "injected"],
      ["StatefulSet", "otel-apps/ledger", "injected"],
      ["CronJob", "otel-batch/nightly", "injected"],
      ["Deployment", "otel-namespace/inherited", "injected"],
      ["DaemonSet", "otel-namespace/node-agent", "injected"],
      ["Deployment", "otel-orphan/cross-ns", "injected"],
    ]);
  });

  it("says how each injected row resolved, from where, and into which container", () => {
    const checkout = rowOf("otel-apps/checkout");

    expect(checkout.verdict).toEqual({
      tone: "ok",
      label: "Injected",
      reason: "1 of 1 pods carry the agent.",
    });
    expect(checkout.languages[0]?.resolution).toMatchObject({
      kind: "resolved",
      by: "only one in the namespace",
    });
    expect(checkout.containers).toEqual({ names: ["app"], predicted: false });
    expect(checkout.instrumentation && keyOf(checkout.instrumentation)).toBe("otel-apps/python");
    expect(rowOf("otel-apps/ledger").languages[0]?.resolution).toMatchObject({ by: "name" });
    expect(rowOf("otel-namespace/inherited").languages[0]?.optIn.from).toBe("Namespace");
    expect(rowOf("otel-namespace/node-agent").languages[0]?.optIn.from).toBe("Namespace");
    expect(rowOf("otel-orphan/cross-ns").instrumentation?.getNs()).toBe("otel-apps");
  });

  it("explains each row a restart cannot fix", () => {
    expect(rowOf("otel-apps/typo").verdict.reason).toBe("otel-apps/absent does not exist.");
    expect(rowOf("otel-orphan/orphan").verdict.reason).toBe("No Instrumentation in otel-orphan.");
    expect(rowOf("otel-ambiguous/ambiguous").verdict.reason).toBe(
      "2 Instrumentations in otel-ambiguous (python-a, python-b); the annotation must name one.",
    );
    expect(rowOf("otel-apps/misplaced").verdict.reason).toBe(
      "inject-python is on the Deployment's own annotations, which the operator never reads; it belongs on the pod template.",
    );
    expect(rowOf("otel-namespace/opted-out").verdict.reason).toBe(
      'The pod template sets inject-python to "false".',
    );
  });

  it("resolves a misplaced key as it would be on the template", () => {
    expect(rowOf("otel-apps/misplaced").instrumentation?.getName()).toBe("python");
  });

  it("counts the pods that started without the agent and predicts its container", () => {
    const late = rowOf("otel-late/late");

    expect(late.verdict).toEqual({
      tone: "warning",
      label: "Restart needed",
      reason: "1 of 1 pods started without the agent.",
    });
    expect(late.containers).toEqual({ names: ["app"], predicted: true });
    expect(late.blockers).toEqual([]);
  });

  it("counts each filter, and each filter keeps its own rows", () => {
    const all = rows();

    expect(tally(all)).toEqual({
      all: 17,
      attention: 10,
      "restart-needed": 2,
      "not-injected": 8,
      injected: 6,
      "opted-out": 1,
    });
    expect(all.filter((row) => matchesFilter(row, "not-injected")).map((row) => row.name)).toEqual([
      "typo",
      "migrate",
      "orphan",
      "ambiguous",
      "misplaced",
      "go-service",
      "polyglot",
      "secure",
    ]);
    expect(
      all.filter((row) => matchesFilter(row, "attention")).map((row) => row.state),
    ).not.toContain("opted-out");
  });

  it("reads a filter from the route, and anything else as all", () => {
    expect(COVERAGE_FILTERS.map(filterOf)).toEqual(COVERAGE_FILTERS);
    expect(filterOf("bogus")).toBe("all");
    expect(filterOf(undefined)).toBe("all");
  });
});

describe("states the seed does not hold", () => {
  it("warns that the next restart drops the agent once a second Instrumentation appears", () => {
    const second = variant(instrumentationNamed("otel-apps/python"), (data) => {
      data.metadata.name = "python-b";
    });
    const checkout = rowOf("otel-apps/checkout", {
      ...coverageInventory(),
      instrumentations: [...instrumentations(), second],
    });

    expect(checkout.state).toBe("ambiguous");
    expect(checkout.verdict.reason).toBe(
      "2 Instrumentations in otel-apps (python, python-b); the annotation must name one. The next restart drops the agent its pods carry now.",
    );
  });

  it("says the same when the Instrumentation the pods got is gone", () => {
    const checkout = rowOf("otel-apps/checkout", {
      ...coverageInventory(),
      instrumentations: instrumentations().filter((each) => each.getNs() !== "otel-apps"),
    });

    expect(checkout.verdict.reason).toBe(
      "No Instrumentation in otel-apps. The next restart drops the agent its pods carry now.",
    );
  });

  it("lets a Namespace's name override the template's true", () => {
    const named = namespaces().map((each) =>
      each.getName() === "otel-apps"
        ? variant(each, (data) => {
            data.metadata.annotations = { [PYTHON]: "otel-late/python" };
          })
        : each,
    );
    const checkout = rowOf("otel-apps/checkout", { ...coverageInventory(), namespaces: named });

    expect(checkout.languages[0]?.optIn.from).toBe("Namespace");
    expect(checkout.instrumentation && keyOf(checkout.instrumentation)).toBe("otel-late/python");
  });

  it("blames the misplaced key, not a Namespace's false that a template value would beat", () => {
    const off = namespaces().map((each) =>
      each.getName() === "otel-apps"
        ? variant(each, (data) => {
            data.metadata.annotations = { [PYTHON]: "false" };
          })
        : each,
    );
    const misplaced = rowOf("otel-apps/misplaced", { ...coverageInventory(), namespaces: off });

    expect(misplaced.state).toBe("misplaced");
    expect(misplaced.instrumentation && keyOf(misplaced.instrumentation)).toBe("otel-apps/python");
  });

  it("ignores a false on the workload's own metadata beside a template that opts in", () => {
    const late = variant(workloadNamed("otel-late/late"), (data) => {
      data.metadata.annotations = {
        ...data.metadata.annotations,
        [`${PREFIX}inject-java`]: "false",
      };
    });
    const row = rowOf("otel-late/late", { ...coverageInventory(), workloads: [late] });

    expect(row.languages.map((each) => each.label)).toEqual(["Python"]);
    expect(row.state).toBe("restart-needed");
  });

  it("needs the agent of the language asked for, not whichever the pods carry", () => {
    const java = namespaces().map((each) =>
      each.getName() === "otel-namespace"
        ? variant(each, (data) => {
            data.metadata.annotations = { [`${PREFIX}inject-java`]: "true" };
          })
        : each,
    );
    const inherited = rowOf("otel-namespace/inherited", {
      ...coverageInventory(),
      namespaces: java,
    });

    expect(inherited.languages.map((each) => each.label)).toEqual(["Java"]);
    expect(inherited.state).toBe("restart-needed");
  });

  it("gives no row to a template that only opts out", () => {
    const optedOut = variant(workloadNamed("otel-apps/checkout"), (data) => {
      data.spec.template.metadata = {
        ...data.spec.template.metadata,
        annotations: { [PYTHON]: "false" },
      };
    });

    expect(rows({ ...coverageInventory(), workloads: [optedOut] })).toEqual([]);
  });

  it("says injected pods keep the agent after an opt-out until they restart", () => {
    const optedOut = variant(workloadNamed("otel-namespace/inherited"), (data) => {
      data.spec.template.metadata = {
        ...data.spec.template.metadata,
        annotations: { [PYTHON]: "false" },
      };
    });
    const inherited = rowOf("otel-namespace/inherited", {
      ...coverageInventory(),
      workloads: [optedOut],
    });

    expect(inherited.verdict.reason).toBe(
      'The pod template sets inject-python to "false". 1 of 1 pods carry the agent until they restart.',
    );
  });

  it("treats a workload with no pods as injected: the next pod gets the agent", () => {
    const late = rowOf("otel-late/late", {
      ...coverageInventory(),
      pods: coverageInventory().pods.filter((pod) => pod.getNs() !== "otel-late"),
    });

    expect(late.verdict).toMatchObject({
      label: "Injected",
      reason: "No pods; the next one gets the agent.",
    });
  });

  it("keeps a second language and takes the worst of them", () => {
    const both = variant(workloadNamed("otel-apps/checkout"), (data) => {
      Object.assign(data.spec.template.metadata?.annotations ?? {}, {
        [`${PREFIX}inject-java`]: "otel-orphan/absent",
        [`${PREFIX}container-names`]: "app",
      });
    });
    const checkout = rowOf("otel-apps/checkout", { ...coverageInventory(), workloads: [both] });

    expect(checkout.languages.map((each) => each.label)).toEqual(["Java", "Python"]);
    expect(checkout.state).toBe("no-instrumentation");
    expect(checkout.verdict.reason).toMatch(/^otel-orphan\/absent does not exist\./);
  });

  it("blocks two languages without container names, whose pods carry only one agent", () => {
    const both = variant(workloadNamed("otel-apps/checkout"), (data) => {
      Object.assign(data.spec.template.metadata?.annotations ?? {}, {
        [`${PREFIX}inject-java`]: "otel-apps/python",
      });
    });
    const checkout = rowOf("otel-apps/checkout", { ...coverageInventory(), workloads: [both] });

    expect(checkout.state).toBe("blocked");
    expect(checkout.verdict.reason).toBe(
      "Java and Python are injected together, so each must name its containers.",
    );
  });

  it("orders two kinds of one name by kind", () => {
    const checkout = workloadNamed("otel-apps/checkout");
    const twin = variant(checkout, (data) => {
      data.kind = "StatefulSet";
    });
    const replicaSet = variant(checkout, (data) => {
      data.kind = "ReplicaSet";
    });

    expect(
      rows({ ...coverageInventory(), workloads: [twin, replicaSet, checkout] }).map(
        (row) => row.kind,
      ),
    ).toEqual(["Deployment", "StatefulSet"]);
  });
});

describe("a TLS Secret or ConfigMap the operator looks up in the pod's namespace", () => {
  const lateWith = (
    tls: { secretName?: string; configMapName?: string },
    references?: CoverageInventory["references"],
  ) =>
    rowOf("otel-late/late", {
      ...coverageInventory(),
      instrumentations: withTls("otel-late/python", tls),
      references,
    });

  it("blocks the restart when the Secret is not there", () => {
    const late = lateWith(
      { secretName: "otel-ca" },
      { secrets: listingsOf(["otel-late"]), configMaps: listingsOf(["otel-late"]) },
    );

    expect(late.verdict).toEqual({
      tone: "critical",
      label: "Blocked",
      reason: "The TLS Secret otel-ca named by otel-late/python is not in otel-late.",
    });
  });

  it("blocks secure, whose otel-tls lacks the Secret its Instrumentation names", () => {
    const secure = rowOf("otel-tls/secure", {
      ...coverageInventory(),
      references: { secrets: new Map([["otel-tls", secretNames()]]) },
    });

    expect(secure.verdict).toEqual({
      tone: "critical",
      label: "Blocked",
      reason: "The TLS Secret otel-ca named by otel-tls/python is not in otel-tls.",
    });
  });

  it("cannot tell when the pod's namespace refused the listing", () => {
    expect(
      lateWith(
        { secretName: "otel-ca" },
        { secrets: new Map([["otel-late", { error: "403 Forbidden" }]]) },
      ).verdict,
    ).toEqual({
      tone: "warning",
      label: "Unknown",
      reason:
        "The TLS Secret otel-ca named by otel-late/python could not be looked up in otel-late (403 Forbidden).",
    });
  });

  it("reads Checking, not Unknown, until the pod's namespace is listed", () => {
    const checking = {
      tone: "info",
      label: "Checking",
      reason: "The TLS Secret otel-ca named by otel-late/python is not looked up in otel-late yet.",
    };

    expect(lateWith({ secretName: "otel-ca" }).verdict).toEqual(checking);
    expect(
      lateWith({ secretName: "otel-ca" }, { secrets: listingsOf(["otel-apps"]) }).verdict,
    ).toEqual(checking);
  });

  it("reads Unknown when one doubt is refused, though another is only not read yet", () => {
    const late = rowOf("otel-late/late", {
      ...coverageInventory(),
      instrumentations: withTls("otel-late/python", { secretName: "otel-ca" }),
      references: { secrets: new Map([["otel-late", { error: "403 Forbidden" }]]) },
      operator: undefined,
    });

    expect(late.verdict.label).toBe("Unknown");
  });

  it("keeps a namespace listed when another namespace refuses", () => {
    const late = lateWith(
      { secretName: "otel-ca" },
      {
        secrets: new Map([...listingsOf(["otel-late"]), ["otel-apps", { error: "403 Forbidden" }]]),
      },
    );

    expect(late.verdict.label).toBe("Blocked");
  });

  it("leaves the restart needed when both are there", () => {
    const late = lateWith(
      { secretName: "otel-ca", configMapName: "otel-ca" },
      {
        secrets: listingsOf(["otel-late"], ["otel-late/otel-ca"]),
        configMaps: listingsOf(["otel-late"], ["otel-late/otel-ca"]),
      },
    );

    expect(late.state).toBe("restart-needed");
  });

  it("names the ConfigMap when only it is missing", () => {
    const late = lateWith(
      { secretName: "otel-ca", configMapName: "otel-bundle" },
      {
        secrets: listingsOf(["otel-late"], ["otel-late/otel-ca"]),
        configMaps: listingsOf(["otel-late"]),
      },
    );

    expect(late.verdict.reason).toBe(
      "The TLS ConfigMap otel-bundle named by otel-late/python is not in otel-late.",
    );
  });

  it("looks in the pod's namespace, not the Instrumentation's, for a cross-namespace reference", () => {
    const inventory = {
      ...coverageInventory(),
      instrumentations: withTls("otel-apps/python", { secretName: "otel-ca" }),
      references: { secrets: listingsOf(["otel-apps", "otel-orphan"], ["otel-apps/otel-ca"]) },
    };
    const crossNs = rowOf("otel-orphan/cross-ns", inventory);

    expect(rowOf("otel-apps/checkout", inventory).blockers).toEqual([]);
    expect(crossNs.state).toBe("injected");
    expect(crossNs.verdict.reason).toBe(
      "1 of 1 pods carry the agent. The next restart drops it: the TLS Secret otel-ca named by otel-apps/python is not in otel-orphan.",
    );
    expect(
      rowOf("otel-orphan/cross-ns", {
        ...inventory,
        pods: inventory.pods.filter(
          (pod) => pod.getName() !== podOf("otel-orphan", "cross-ns").getName(),
        ),
      }).state,
    ).toBe("blocked");
  });

  it("asks nothing of an Instrumentation without TLS", () => {
    expect(tlsBlockers(instrumentationNamed("otel-late/python"), "otel-late")).toEqual([]);
  });

  it("looks up names only in the pod namespaces of rows that wait for them", () => {
    const inventory = {
      ...coverageInventory(),
      instrumentations: withTls("otel-apps/python", { secretName: "otel-ca" }),
      references: undefined,
    };
    const waiting = ["otel-apps", "otel-batch", "otel-blocked", "otel-orphan", "otel-tls"];

    expect(lookupNamespaces(rows(inventory))).toEqual(waiting);
    expect(
      lookupNamespaces(
        rows({ ...inventory, references: { secrets: listingsOf(waiting, ["otel-apps/otel-ca"]) } }),
      ),
    ).toEqual([]);
    expect(lookupNamespaces(rows({ ...coverageInventory(), references: undefined }))).toEqual([
      "otel-tls",
    ]);
    expect(lookupNamespaces(rows())).toEqual([]);
  });

  it("keeps waiting on a namespace that refused, so it is listed again", () => {
    const refused = {
      ...coverageInventory(),
      references: { secrets: new Map([["otel-tls", { error: "403 Forbidden" }]]) },
    };

    expect(lookupNamespaces(rows(refused))).toEqual(["otel-tls"]);
  });

  it("builds again only the rows that waited on names once they are read", () => {
    const unlooked = rows({ ...coverageInventory(), references: undefined });
    const looked = withReferences(unlooked, coverageInventory());
    const secure = (list: CoverageRow[]) => list.find((row) => row.name === "secure");

    expect(looked.map((row) => [row.key, row.verdict])).toEqual(
      rows().map((row) => [row.key, row.verdict]),
    );
    expect(secure(looked)).not.toBe(secure(unlooked));
    for (const row of looked.filter((each) => each.name !== "secure")) {
      expect(unlooked).toContain(row);
    }
  });

  it("keeps the rows as they are when none waited on names", () => {
    const list = rows();

    expect(withReferences(list, coverageInventory())).toBe(list);
  });
});

describe("what else the webhook checks before it injects", () => {
  const gatewayValueFrom = () =>
    workloadNamed(
      "otel-collectors/gateway-collector",
    ).spec.template.spec?.containers?.[0]?.env?.find((env) => env.valueFrom)?.valueFrom;

  it("blocks a sidecar annotation naming a collector that does not exist", () => {
    expect(lateAnnotated({ [SIDECAR_INJECT]: "absent" }).verdict).toEqual({
      tone: "critical",
      label: "Blocked",
      reason:
        "The collector otel-late/absent that sidecar.opentelemetry.io/inject names does not exist, so the webhook adds nothing.",
    });
    expect(lateAnnotated({ [SIDECAR_INJECT]: "otel-collectors/gateway" }).state).toBe(
      "restart-needed",
    );
    expect(lateAnnotated({ [SIDECAR_INJECT]: "true" }).state).toBe("restart-needed");
  });

  it("reads Checking before the collectors are loaded, and Unknown once that gave up", () => {
    const unloaded = { ...coverageInventory(), collectors: undefined };
    const late = lateAnnotated({ [SIDECAR_INJECT]: "otel-collectors/absent" }, unloaded);

    expect(late.verdict).toEqual({
      label: "Checking",
      tone: "info",
      reason:
        "The collector otel-collectors/absent that sidecar.opentelemetry.io/inject names is not looked up yet.",
    });
    expect(lookupNamespaces([late])).toEqual([]);
    expect(
      lateAnnotated(
        { [SIDECAR_INJECT]: "otel-collectors/absent" },
        { ...unloaded, gaveUp: { collectors: true } },
      ).verdict,
    ).toMatchObject({ label: "Unknown", tone: "warning" });
  });

  it("blocks a Python platform other than glibc or musl, even where pods carry the init container", () => {
    const checkout = variant(workloadNamed("otel-apps/checkout"), (data) => {
      Object.assign(data.spec.template.metadata?.annotations ?? {}, {
        [PYTHON_PLATFORM]: "alpine",
      });
    });

    expect(
      rowOf("otel-apps/checkout", { ...coverageInventory(), workloads: [checkout] }).verdict,
    ).toEqual({
      tone: "critical",
      label: "Blocked",
      reason: `The platform "alpine" that ${PYTHON_PLATFORM} names is not glibc or musl, so no container gets the agent.`,
    });
    expect(lateAnnotated({ [PYTHON_PLATFORM]: "musl" }).state).toBe("restart-needed");
    expect(lateAnnotated({ [PYTHON_PLATFORM]: "glibc" }).state).toBe("restart-needed");
  });

  it("blocks Python when every container it would set up takes PYTHONPATH from valueFrom", () => {
    const fromValue = (names: string[]) =>
      variant(workloadNamed("otel-late/late"), (data) => {
        const [app] = data.spec.template.spec?.containers ?? [];

        if (!app) throw new Error("late has no container");

        data.spec.template.spec = {
          ...data.spec.template.spec,
          containers: names.map((name, at) => ({
            ...app,
            name,
            env: at === 0 ? [{ name: "PYTHONPATH", valueFrom: gatewayValueFrom() }] : [],
          })),
        };
        data.spec.template.metadata = {
          ...data.spec.template.metadata,
          annotations: { [`${PREFIX}container-names`]: names.join(",") },
        };
      });
    const rowWith = (names: string[]) =>
      rowOf("otel-late/late", { ...coverageInventory(), workloads: [fromValue(names)] });

    expect(gatewayValueFrom()).toBeDefined();
    expect(rowWith(["app"]).verdict.reason).toBe(
      "Container app takes PYTHONPATH from valueFrom, so the operator skips it.",
    );
    expect(rowWith(["app", "worker"]).state).toBe("restart-needed");
  });
});

describe("the languages the operator's Deployment turns on", () => {
  const GO = `${PREFIX}inject-go`;
  const withOperator = (operator: CoverageInventory["operator"]) => ({
    ...coverageInventory(),
    operator,
  });

  it("blocks Go, off by default, and leaves it out of the container rule", () => {
    expect(lateAnnotated({ [GO]: "otel-late/python" }).verdict).toEqual({
      tone: "critical",
      label: "Blocked",
      reason: "The operator does not inject Go: --enable-go-instrumentation is off by default.",
    });
  });

  it("reads a flag in the manager's args, and applies the container rule once Go is on", () => {
    const goOn = withOperator(
      operatorWith((manager) => {
        manager.args = [...(manager.args ?? []), "--enable-go-instrumentation"];
      }),
    );

    expect(lateAnnotated({ [PYTHON]: "true", [GO]: "true" }, goOn).verdict.reason).toBe(
      "Python and Go are injected together, so each must name its containers.",
    );
  });

  it("blocks a language its args turn off, and names the flag", () => {
    const pythonOff = withOperator(
      operatorWith((manager) => {
        manager.args = [...(manager.args ?? []), "--enable-python-instrumentation=false"];
      }),
    );

    expect(rowOf("otel-late/late", pythonOff).verdict).toEqual({
      tone: "critical",
      label: "Blocked",
      reason:
        "The operator does not inject Python: its args set --enable-python-instrumentation=false.",
    });
    expect(rowOf("otel-apps/checkout", pythonOff).verdict.reason).toBe(
      "1 of 1 pods carry the agent. The next restart drops it: the operator does not inject Python: its args set --enable-python-instrumentation=false.",
    );
  });

  it("reads Checking before the operator's Deployment is read, Unknown when it is not there", () => {
    expect(rowOf("otel-late/late", withOperator(undefined)).verdict).toEqual({
      tone: "info",
      label: "Checking",
      reason:
        "The operator's Deployment is not read yet, so whether it injects Python is not known yet.",
    });
    expect(
      lateAnnotated({ [PYTHON]: "true", [GO]: "true" }, withOperator(undefined)).verdict.reason,
    ).toBe(
      "The operator's Deployment is not read yet, so whether it injects Python and Go is not known yet.",
    );
    expect(rowOf("otel-late/late", withOperator({ error: "403 Forbidden" })).verdict.reason).toBe(
      "Whether the operator injects Python could not be read: the operator's Deployment could not be listed (403 Forbidden).",
    );
    expect(
      lateAnnotated({ [PYTHON]: "true", [GO]: "true" }, withOperator({ items: [] })).verdict.reason,
    ).toBe(
      "Whether the operator injects Python and Go could not be read: no Deployment carries app.kubernetes.io/name=opentelemetry-operator.",
    );
    expect(rowOf("otel-apps/checkout", withOperator(undefined)).state).toBe("injected");
  });
});

describe("before every namespace's Instrumentations are read", () => {
  const unread = (gaveUp?: boolean) =>
    rows({
      ...coverageInventory(),
      instrumentations: undefined,
      gaveUp: { instrumentations: gaveUp },
    });

  it("reads Checking, never No Instrumentation or Ambiguous, and asks no attention", () => {
    const all = unread();

    expect(
      all.filter((row) => row.state !== "pending").map((row) => [row.name, row.state]),
    ).toEqual([
      ["misplaced", "misplaced"],
      ["opted-out", "opted-out"],
    ]);
    expect(all.find((row) => row.name === "orphan")?.verdict).toEqual({
      tone: "info",
      label: "Checking",
      reason: "The Instrumentations are not read yet.",
    });
    expect(tally(all)).toMatchObject({ attention: 1, "not-injected": 1 });
    expect(all.find((row) => row.name === "late")?.languages[0]?.resolution).toEqual({
      kind: "unread",
      namespace: "otel-late",
    });
  });

  it("reads Unknown once loading them gave up", () => {
    expect(unread(true).find((row) => row.name === "orphan")?.verdict).toEqual({
      tone: "warning",
      label: "Unknown",
      reason: "The Instrumentations could not be read.",
    });
  });

  it("keeps the page connecting while a row is still being checked", () => {
    expect(coverageLoadState("ready", unread())).toBe("connecting");
    expect(coverageLoadState("ready", rows())).toBe("ready");
    expect(coverageLoadState("unreachable", unread(true))).toBe("unreachable");
  });
});

describe("the filter chips", () => {
  it("label and explain every filter", () => {
    expect(Object.keys(FILTER_LABELS)).toEqual([...COVERAGE_FILTERS]);
    expect(Object.keys(FILTER_TITLES)).toEqual([...COVERAGE_FILTERS]);
  });
});

describe("batch workloads", () => {
  const PYTHON_OPT_IN = `${PREFIX}inject-python`;
  /** The inventory with the pod of `app` in otel-batch changed. */
  const withPod = (app: string, change: (pod: PodLike) => PodLike) => {
    const name = podOf("otel-batch", app).getName();

    return {
      ...coverageInventory(),
      pods: pods().map((pod) => (pod.getName() === name ? change(pod) : pod)),
    };
  };
  const withoutAgent = (pod: PodLike) =>
    variant(pod, (data) => {
      data.spec = { ...data.spec, initContainers: [] };
    });
  /** The inventory with one workload replaced, its Jobs kept. */
  const replacing = (
    key: string,
    change: (data: WorkloadLike) => void,
    inventory = coverageInventory(),
  ) => ({
    ...inventory,
    workloads: [
      ...inventory.workloads.filter((each) => keyOf(each) !== key),
      variant(workloadNamed(key), change),
    ],
  });

  it("counts a CronJob's last Job's pods, and gives that Job no row", () => {
    const nightly = rowOf("otel-batch/nightly");

    expect(nightly).toMatchObject({ kind: "CronJob", run: "nightly-run", injected: 1, total: 1 });
    expect(nightly.verdict.reason).toBe("1 of 1 pods of its last Job carry the agent.");
    expect(nightly.instrumentation && keyOf(nightly.instrumentation)).toBe("otel-apps/python");
    expect(rows().some((row) => row.name === "nightly-run")).toBe(false);
  });

  it("judges a Job nothing owns like any workload", () => {
    const migrate = rowOf("otel-batch/migrate");

    expect(migrate).toMatchObject({
      kind: "Job",
      state: "no-instrumentation",
      injected: 0,
      total: 1,
    });
    expect(migrate.run).toBeUndefined();
    expect(migrate.verdict.reason).toBe("No Instrumentation in otel-batch.");
  });

  it("says the next run gets the agent, never Restart needed, when the last one ran without it", () => {
    const nightly = rowOf("otel-batch/nightly", withPod("nightly", withoutAgent));
    const migrate = rowOf(
      "otel-batch/migrate",
      replacing("otel-batch/migrate", (data) => {
        data.spec.template.metadata = {
          ...data.spec.template.metadata,
          annotations: { [PYTHON_OPT_IN]: "otel-apps/python" },
        };
      }),
    );

    expect([nightly.state, nightly.verdict.reason]).toEqual([
      "injected",
      "1 of 1 pods of its last Job started without the agent; the next run gets it.",
    ]);
    expect([migrate.state, migrate.verdict.reason]).toEqual([
      "injected",
      "1 of 1 pods started without the agent; the next run gets it.",
    ]);
  });

  it("speaks of the next run, not a restart, when the agent goes away", () => {
    // An opt-out alone gives no row: the Namespace opts in, the template out.
    const optingIn = namespaces().map((each) =>
      each.getName() === "otel-batch"
        ? variant(each, (data) => {
            data.metadata.annotations = { [PYTHON_OPT_IN]: "true" };
          })
        : each,
    );
    const optedOut = rowOf(
      "otel-batch/nightly",
      replacing(
        "otel-batch/nightly",
        (data) => {
          const template = data.spec.jobTemplate?.spec?.template;

          if (template) {
            template.metadata = { ...template.metadata, annotations: { [PYTHON_OPT_IN]: "false" } };
          }
        },
        { ...coverageInventory(), namespaces: optingIn },
      ),
    );
    const gone = rowOf("otel-batch/nightly", {
      ...coverageInventory(),
      instrumentations: instrumentations().filter((each) => each.getNs() !== "otel-apps"),
    });

    expect(optedOut.verdict.reason).toBe(
      'The pod template sets inject-python to "false". 1 of 1 pods of its last Job carry the agent; the next run does not.',
    );
    expect(gone.verdict.reason).toBe(
      "otel-apps/python does not exist. The next run drops the agent its pods carry now.",
    );
  });

  it("reads what the webhook checks from a CronJob's jobTemplate", () => {
    const gatewayValueFrom = () =>
      workloadNamed(
        "otel-collectors/gateway-collector",
      ).spec.template.spec?.containers?.[0]?.env?.find((env) => env.valueFrom)?.valueFrom;
    const nightlyWith = (change: (template: PodTemplate) => void) =>
      rowOf(
        "otel-batch/nightly",
        replacing("otel-batch/nightly", (data) => {
          const template = data.spec.jobTemplate?.spec?.template;

          if (!template) throw new Error("nightly has no jobTemplate");
          change(template);
        }),
      );
    const annotated = (annotations: Record<string, string>) =>
      nightlyWith((template) => {
        Object.assign(template.metadata?.annotations ?? {}, annotations);
      });

    const texts = (row: CoverageRow) => row.blockers.map((blocker) => blocker.text);

    expect(texts(annotated({ [SIDECAR_INJECT]: "absent" }))).toEqual([
      "the collector otel-batch/absent that sidecar.opentelemetry.io/inject names does not exist, so the webhook adds nothing",
    ]);
    expect(texts(annotated({ [PYTHON_PLATFORM]: "alpine" }))).toEqual([
      `the platform "alpine" that ${PYTHON_PLATFORM} names is not glibc or musl, so no container gets the agent`,
    ]);
    expect(texts(annotated({ [COMMON_CONTAINER_NAMES]: "app, web" }))).toEqual([
      `${COMMON_CONTAINER_NAMES} is "app, web", not a comma-separated list of container names`,
    ]);
    expect(
      texts(
        nightlyWith((template) => {
          for (const each of template.spec?.containers ?? []) {
            each.env = [{ name: "PYTHONPATH", valueFrom: gatewayValueFrom() }];
          }
        }),
      ),
    ).toEqual(["container app takes PYTHONPATH from valueFrom, so the operator skips it"]);
  });

  it("keeps a CronJob's pods when its row is built again with the names read", () => {
    const inventory = {
      ...coverageInventory(),
      instrumentations: withTls("otel-apps/python", { secretName: "otel-ca" }),
    };
    const unlooked = rows({ ...inventory, references: undefined });
    const looked = withReferences(unlooked, {
      ...inventory,
      references: { secrets: listingsOf(lookupNamespaces(unlooked)) },
    });
    const nightly = looked.find((row) => row.name === "nightly");

    expect(lookupNamespaces(unlooked)).toContain("otel-batch");
    expect(nightly).toMatchObject({ state: "injected", injected: 1, total: 1 });
    expect(nightly?.verdict.reason).toBe(
      "1 of 1 pods of its last Job carry the agent. The next run drops it: the TLS Secret otel-ca named by otel-apps/python is not in otel-batch.",
    );
  });
});
