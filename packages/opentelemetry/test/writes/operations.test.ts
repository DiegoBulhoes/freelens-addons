import { describe, expect, it } from "vitest";
import { collectorRows } from "../../src/renderer/api/collectors/collectors";
import { PREFIX } from "../../src/renderer/api/coverage/annotations";
import {
  type CoverageInventory,
  type CoverageRow,
  coverageRows,
} from "../../src/renderer/api/coverage/coverage";
import type { OperatorList } from "../../src/renderer/api/coverage/operator";
import { keyOf } from "../../src/renderer/api/coverage/resolve";
import { planFor } from "../../src/renderer/api/writes/bulk";
import {
  annotationYaml,
  BULK_RESTART_DETAIL,
  BULK_RESTART_TOOLTIP,
  collectorCommandsOf,
  commandsOf,
  RESTART_HINT,
  RESTART_TOOLTIP,
  restartDetail,
  restartRefusal,
} from "../../src/renderer/api/writes/operations";
import {
  collectors,
  coverageInventory,
  instrumentations,
  listingsOf,
  NOW,
  namespaces,
  operatorDeployments,
  podOf,
  pods,
  variant,
  workloadNamed,
  workloads,
} from "../support/fixtures";

const rowOf = (key: string, inventory: CoverageInventory = coverageInventory()): CoverageRow => {
  const found = coverageRows(inventory).find((row) => `${row.namespace}/${row.name}` === key);

  if (!found) throw new Error(`no row for ${key}`);

  return found;
};

const lateWithTls = (references?: CoverageInventory["references"]) =>
  rowOf("otel-late/late", {
    ...coverageInventory(),
    instrumentations: instrumentations().map((each) =>
      keyOf(each) === "otel-late/python"
        ? variant(each, (data) => {
            data.spec.exporter = { ...data.spec.exporter, tls: { secretName: "otel-ca" } };
          })
        : each,
    ),
    references,
  });

describe("refusing a restart", () => {
  it("allows only Restart needed, and says why for every other seeded row", () => {
    expect(coverageRows(coverageInventory()).map((row) => [row.name, restartRefusal(row)])).toEqual(
      [
        ["typo", "A restart would not help: otel-apps/absent does not exist."],
        ["migrate", "A Job has no restart; only a new Job's pods are admitted afresh."],
        ["orphan", "A restart would not help: No Instrumentation in otel-orphan."],
        [
          "ambiguous",
          "A restart would not help: 2 Instrumentations in otel-ambiguous (python-a, python-b); the annotation must name one.",
        ],
        [
          "misplaced",
          "A restart would not help: inject-python is on the Deployment's own annotations, which the operator never reads; it belongs on the pod template.",
        ],
        [
          "go-service",
          "A restart would not help: The operator does not inject Go: --enable-go-instrumentation is off by default.",
        ],
        [
          "polyglot",
          "A restart would not help: Node.js and Python are injected together, so each must name its containers.",
        ],
        [
          "secure",
          "A restart would not help: The TLS Secret otel-ca named by otel-tls/python is not in otel-tls.",
        ],
        ["late", undefined],
        ["late-agent", undefined],
        ["opted-out", "Opted out."],
        ["checkout", "Already injected."],
        ["ledger", "Already injected."],
        ["nightly", "A CronJob has no restart; each run's pods are admitted afresh."],
        ["inherited", "Already injected."],
        ["node-agent", "Already injected."],
        ["cross-ns", "Already injected."],
      ],
    );
  });

  it("refuses a workload without pods, and the TLS blockers, checked or not", () => {
    const empty = rowOf("otel-late/late", {
      ...coverageInventory(),
      pods: pods().filter((pod) => pod.getNs() !== "otel-late"),
    });

    expect(restartRefusal(empty)).toBe("No pods to restart.");
    expect(restartRefusal(lateWithTls({ secrets: listingsOf(["otel-late"]) }))).toBe(
      "A restart would not help: The TLS Secret otel-ca named by otel-late/python is not in otel-late.",
    );
    const refused = new Map([["otel-late", { error: "403 Forbidden" }]]);

    expect(restartRefusal(lateWithTls({ secrets: refused }))).toBe(
      "A restart may not help: The TLS Secret otel-ca named by otel-late/python could not be looked up in otel-late (403 Forbidden).",
    );
    expect(restartRefusal(lateWithTls())).toBe(
      "Not checked yet: The TLS Secret otel-ca named by otel-late/python is not looked up in otel-late yet.",
    );
  });

  it("allows a restart when only the operator's Deployment could not be listed", () => {
    const refused: CoverageInventory = {
      ...coverageInventory(),
      operator: { error: "403 Forbidden" },
    };
    const late = rowOf("otel-late/late", refused);

    expect(late.state).toBe("unknown");
    expect(restartRefusal(late)).toBeUndefined();
    expect(
      restartRefusal(
        rowOf("otel-late/late", {
          ...refused,
          pods: pods().filter((pod) => pod.getNs() !== "otel-late"),
        }),
      ),
    ).toBe("No pods to restart.");
  });

  it("refuses while the operator's Deployment or the Instrumentations are not read", () => {
    const refusal = (unread: Partial<CoverageInventory>) =>
      restartRefusal(rowOf("otel-late/late", { ...coverageInventory(), ...unread }));

    expect(refusal({ operator: undefined })).toBe(
      "Not checked yet: The operator's Deployment is not read yet, so whether it injects Python is not known yet.",
    );
    expect(refusal({ instrumentations: undefined })).toBe(
      "Not checked yet: The Instrumentations are not read yet.",
    );
  });

  it("refuses when the Instrumentations could not be read, though no blocker is listed", () => {
    const late = rowOf("otel-late/late", {
      ...coverageInventory(),
      instrumentations: undefined,
      gaveUp: { instrumentations: true },
    });

    expect(late.state).toBe("unknown");
    expect(late.blockers).toEqual([]);
    expect(restartRefusal(late)).toBe(
      "A restart may not help: The Instrumentations could not be read.",
    );
  });

  it("refuses a workload whose pods a restart would not replace", () => {
    const paused = variant(workloadNamed("otel-late/late"), (data) => {
      data.spec.paused = true;
    });
    const onDelete = variant(workloadNamed("otel-late/late-agent"), (data) => {
      data.spec.updateStrategy = { type: "OnDelete" };
    });

    expect(
      restartRefusal(rowOf("otel-late/late", { ...coverageInventory(), workloads: [paused] })),
    ).toBe("It is paused, so a restart replaces no pod until it is resumed.");
    expect(
      restartRefusal(
        rowOf("otel-late/late-agent", { ...coverageInventory(), workloads: [onDelete] }),
      ),
    ).toBe(
      "Its update strategy is OnDelete, so a restart replaces no pod; delete its pods instead.",
    );
  });

  it("names every refused row in a sentence of its own", () => {
    const plan = planFor(
      coverageRows(coverageInventory()).filter((row) => row.state === "injected"),
      restartRefusal,
    );

    expect(plan.ready).toEqual([]);
    expect(plan.skipped.every(({ reason }) => /^[A-Z].*\.$/.test(reason))).toBe(true);
  });

  it("plans a ticked restart of every row: the two late ones go, the rest are skipped with why", () => {
    const plan = planFor(coverageRows(coverageInventory()), restartRefusal);

    expect(plan.ready.map((row) => `${row.namespace}/${row.name}`)).toEqual([
      "otel-late/late",
      "otel-late/late-agent",
    ]);
    expect(plan.skipped.find((each) => each.item.name === "checkout")?.reason).toBe(
      "Already injected.",
    );
  });
});

describe("what the restart texts promise", () => {
  it("offers the bulk restart on each row a restart would inject, Unknown ones included", () => {
    const unknown = rowOf("otel-late/late", {
      ...coverageInventory(),
      operator: { error: "403 Forbidden" },
    });
    const plan = planFor([unknown], restartRefusal);

    expect(unknown.state).toBe("unknown");
    expect(plan.ready).toEqual([unknown]);
    for (const text of [RESTART_HINT, BULK_RESTART_TOOLTIP]) {
      expect(text).toMatch(/each ticked workload a restart would inject/);
      expect(text).not.toMatch(/Restart needed/);
    }
  });

  it("names a StatefulSet's partition wherever it says the pods roll", () => {
    for (const text of [BULK_RESTART_DETAIL, BULK_RESTART_TOOLTIP, RESTART_TOOLTIP]) {
      expect(text).toMatch(
        /a StatefulSet with a partition rolls only its pods from that ordinal up/,
      );
      expect(text).not.toMatch(/every pod/);
    }
  });
});

describe("what a restart does", () => {
  it("names the kind, the agent, the Instrumentation and the container", () => {
    expect(restartDetail(rowOf("otel-late/late"))).toBe(
      "Rolls every pod of Deployment late; the new pods get the Python agent from otel-late/python in container app.",
    );
  });

  it("says a StatefulSet's partition holds back the pods below it", () => {
    const ledger = variant(workloadNamed("otel-apps/ledger"), (data) => {
      data.spec.updateStrategy = { type: "RollingUpdate", rollingUpdate: { partition: 2 } };
    });

    expect(
      restartDetail(rowOf("otel-apps/ledger", { ...coverageInventory(), workloads: [ledger] })),
    ).toMatch(/^Rolls the pods of StatefulSet ledger from ordinal 2 up, as its partition allows;/);
  });

  it("names every container the annotation lists", () => {
    const listed = variant(workloadNamed("otel-late/late"), (data) => {
      data.spec.template.metadata = {
        ...data.spec.template.metadata,
        annotations: { [`${PREFIX}container-names`]: "app,worker" },
      };
    });

    expect(
      restartDetail(rowOf("otel-late/late", { ...coverageInventory(), workloads: [listed] })),
    ).toMatch(/in containers app, worker\.$/);
  });
});

describe("the annotation to commit", () => {
  const header = "spec:\n  template:\n    metadata:\n      annotations:\n";

  it("pins a resolved value to namespace/name", () => {
    expect(annotationYaml(rowOf("otel-apps/checkout"), instrumentations())).toBe(
      `${header}        instrumentation.opentelemetry.io/inject-python: "otel-apps/python"`,
    );
    expect(annotationYaml(rowOf("otel-namespace/inherited"), instrumentations())).toBe(
      `${header}        instrumentation.opentelemetry.io/inject-python: "otel-namespace/python"`,
    );
  });

  it("moves a misplaced key onto the template, past a Namespace's false", () => {
    const yaml = `${header}        instrumentation.opentelemetry.io/inject-python: "otel-apps/python"`;
    const off = namespaces().map((each) =>
      each.getName() === "otel-apps"
        ? variant(each, (data) => {
            data.metadata.annotations = { [`${PREFIX}inject-python`]: "false" };
          })
        : each,
    );

    expect(annotationYaml(rowOf("otel-apps/misplaced"), instrumentations())).toBe(yaml);
    expect(
      annotationYaml(
        rowOf("otel-apps/misplaced", { ...coverageInventory(), namespaces: off }),
        instrumentations(),
      ),
    ).toBe(yaml);
  });

  it("lists the candidates of an ambiguous value, and keeps an opt-out as it is", () => {
    expect(annotationYaml(rowOf("otel-ambiguous/ambiguous"), instrumentations())).toBe(
      `${header}        # one of: otel-ambiguous/python-a, otel-ambiguous/python-b\n        instrumentation.opentelemetry.io/inject-python: "true"`,
    );
    expect(annotationYaml(rowOf("otel-namespace/opted-out"), instrumentations())).toBe(
      `${header}        instrumentation.opentelemetry.io/inject-python: "false"`,
    );
  });

  it("names the Instrumentations a value naming nothing could name instead", () => {
    const every = instrumentations().map(keyOf).sort().join(", ");

    expect(every).toContain("otel-apps/python");
    expect(annotationYaml(rowOf("otel-apps/typo"), instrumentations())).toBe(
      `${header}        # one of: ${every}\n        instrumentation.opentelemetry.io/inject-python: "absent"`,
    );
    expect(annotationYaml(rowOf("otel-orphan/orphan"), instrumentations())).toBe(
      `${header}        # one of: ${every}\n        instrumentation.opentelemetry.io/inject-python: "true"`,
    );
  });

  it("says when no Instrumentation exists for a value naming nothing", () => {
    const none = rowOf("otel-orphan/orphan", { ...coverageInventory(), instrumentations: [] });

    expect(annotationYaml(none, [])).toBe(
      `${header}        # no Instrumentation exists\n        instrumentation.opentelemetry.io/inject-python: "true"`,
    );
  });
});

const operatorRead = (): OperatorList => ({ items: operatorDeployments() });

/** The webhook-log commands for otel-late/late against `operator`. */
const operatorCommands = (operator: OperatorList | undefined) =>
  commandsOf(rowOf("otel-late/late"), operator).slice(2);

describe("commands to look further", () => {
  it("lists the pods' init containers, the Instrumentations and the operator's log", () => {
    expect(commandsOf(rowOf("otel-late/late"), operatorRead())).toEqual([
      {
        label: "Which agent each pod got",
        command:
          "kubectl get pods -n otel-late -l app=late -o custom-columns='POD:.metadata.name,INIT:.spec.initContainers[*].name'",
      },
      {
        label: "The Instrumentations in otel-late",
        command: "kubectl get instrumentations.opentelemetry.io -n otel-late",
      },
      {
        label: "What the operator's webhook logged for the namespace",
        command:
          "kubectl logs -n opentelemetry-operator-system deploy/opentelemetry-operator-controller-manager -c manager | grep 'otel-late'",
      },
    ]);
  });

  it("reads the log of the operator's Deployment wherever Helm installed it", () => {
    const helm = operatorDeployments().map((item) => ({
      ...item,
      metadata: { ...item.metadata, name: "opentelemetry-operator", namespace: "otel-operator" },
    }));

    expect(operatorCommands({ items: helm })).toEqual([
      {
        label: "What the operator's webhook logged for the namespace",
        command:
          "kubectl logs -n otel-operator deploy/opentelemetry-operator -c manager | grep 'otel-late'",
      },
    ]);
  });

  it("reads the operator's pods by label in each namespace when several Deployments run", () => {
    const [manifest] = operatorDeployments();

    if (!manifest) throw new Error("no operator Deployment in the fixture");

    const elsewhere = {
      ...manifest,
      metadata: { ...manifest.metadata, namespace: "otel-operator" },
    };
    const selected = "-l app.kubernetes.io/name=opentelemetry-operator -c manager --prefix";

    expect(operatorCommands({ items: [manifest, elsewhere] })).toEqual([
      {
        label:
          "What the operator's webhook logged for the namespace, from opentelemetry-operator-system",
        command: `kubectl logs -n opentelemetry-operator-system ${selected} | grep 'otel-late'`,
      },
      {
        label: "What the operator's webhook logged for the namespace, from otel-operator",
        command: `kubectl logs -n otel-operator ${selected} | grep 'otel-late'`,
      },
    ]);
    expect(operatorCommands({ items: [manifest, manifest] })).toEqual([
      {
        label: "What the operator's webhook logged for the namespace",
        command: `kubectl logs -n opentelemetry-operator-system ${selected} | grep 'otel-late'`,
      },
    ]);
  });

  it("asks where the operator runs while its Deployment is not read, refused or absent", () => {
    const where = [
      {
        label: "Where the operator runs; its manager container logs the webhook",
        command: "kubectl get deployments -A -l app.kubernetes.io/name=opentelemetry-operator",
      },
    ];

    expect(operatorCommands(undefined)).toEqual(where);
    expect(operatorCommands({ error: "403 Forbidden" })).toEqual(where);
    expect(operatorCommands({ items: [] })).toEqual(where);
  });

  it("names no container when the operator's Deployment lists none", () => {
    const bare = operatorDeployments().map((item) => ({
      ...item,
      spec: { template: { spec: { containers: [] } } },
    }));

    expect(operatorCommands({ items: bare })[0]?.command).toBe(
      "kubectl logs -n opentelemetry-operator-system deploy/opentelemetry-operator-controller-manager | grep 'otel-late'",
    );
  });

  it("looks where each value points", () => {
    const where = (key: string) =>
      commandsOf(rowOf(key), operatorRead())
        .filter((each) => each.label.startsWith("The Instrumentations"))
        .map((each) => each.label);

    expect(where("otel-orphan/cross-ns")).toEqual(["The Instrumentations in otel-apps"]);
    expect(where("otel-orphan/orphan")).toEqual(["The Instrumentations in otel-orphan"]);
    expect(where("otel-ambiguous/ambiguous")).toEqual(["The Instrumentations in otel-ambiguous"]);
    expect(where("otel-namespace/opted-out")).toEqual(["The Instrumentations in otel-namespace"]);
  });

  it("lists every pod in the namespace when the workload has no label selector", () => {
    const unlabelled = variant(workloadNamed("otel-late/late"), (data) => {
      data.spec.selector = {};
    });
    const [listing] = commandsOf(
      rowOf("otel-late/late", { ...coverageInventory(), workloads: [unlabelled] }),
      operatorRead(),
    );

    expect(listing?.command).toMatch(/^kubectl get pods -n otel-late -o /);
  });

  it("reads a crashing collector's previous log, and any collector's spec", () => {
    const rows = collectorRows(collectors(), pods(), new Map(), NOW);
    const [broken, gateway, allocator] = ["broken", "gateway", "allocator"].map((name) =>
      rows.find((row) => row.name === name),
    );

    if (!broken || !gateway || !allocator) throw new Error("no collector rows");

    expect(collectorCommandsOf(broken)).toEqual([
      {
        label: "Why it exits: its previous run's log",
        command: `kubectl logs -n otel-collectors ${podOf("otel-collectors", "broken").getName()} -c otc-container --previous`,
      },
      {
        label: "Its spec and status",
        command:
          "kubectl get opentelemetrycollectors.opentelemetry.io -n otel-collectors broken -o yaml",
      },
    ]);
    expect(collectorCommandsOf(gateway)).toHaveLength(1);
    expect(collectorCommandsOf(allocator)[0]).toEqual({
      label: "Why its target allocator exits: its previous run's log",
      command: `kubectl logs -n otel-allocator ${allocator.allocator?.pods[0]?.getName()} -c ta-container --previous`,
    });
  });
});

describe("a batch workload", () => {
  const PYTHON_OPT_IN = `${PREFIX}inject-python`;

  it("is never restarted, even when the only doubt is the operator's Deployment", () => {
    const name = podOf("otel-batch", "nightly").getName();
    const bare = pods().map((pod) =>
      pod.getName() === name
        ? variant(pod, (data) => {
            data.spec = { ...data.spec, initContainers: [] };
          })
        : pod,
    );
    const unknown = rowOf("otel-batch/nightly", {
      ...coverageInventory(),
      pods: bare,
      operator: { error: "403 Forbidden" },
    });

    expect(unknown.state).toBe("unknown");
    expect(restartRefusal(unknown)).toBe(
      "A CronJob has no restart; each run's pods are admitted afresh.",
    );
    expect(planFor([unknown], restartRefusal).ready).toEqual([]);
  });

  it("puts a CronJob's annotation under its jobTemplate", () => {
    expect(annotationYaml(rowOf("otel-batch/nightly"), instrumentations())).toBe(
      [
        "spec:",
        "  jobTemplate:",
        "    spec:",
        "      template:",
        "        metadata:",
        "          annotations:",
        `            ${PYTHON_OPT_IN}: "otel-apps/python"`,
      ].join("\n"),
    );
  });

  it("lists the pods of the Job that ran, by the label the Job controller sets", () => {
    const listing = (key: string) => commandsOf(rowOf(key), operatorRead())[0]?.command;
    const label = "batch.kubernetes.io/job-name";

    expect(podOf("otel-batch", "nightly").metadata.labels?.[label]).toBe("nightly-run");
    expect(podOf("otel-batch", "migrate").metadata.labels?.[label]).toBe("migrate");
    expect(listing("otel-batch/nightly")).toContain(`-n otel-batch -l ${label}=nightly-run -o `);
    expect(listing("otel-batch/migrate")).toContain(`-n otel-batch -l ${label}=migrate -o `);
  });

  it("lists every pod in the namespace for a CronJob that has not run", () => {
    const [listing] = commandsOf(
      rowOf("otel-batch/nightly", {
        ...coverageInventory(),
        workloads: workloads().filter((each) => each.getName() !== "nightly-run"),
      }),
      operatorRead(),
    );

    expect(listing?.command).toMatch(/^kubectl get pods -n otel-batch -o /);
  });
});
