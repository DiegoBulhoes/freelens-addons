import type { CollectorRow } from "../collectors/collectors";
import type { CoverageRow } from "../coverage/coverage";
import { managerOf, OPERATOR_SELECTOR, type OperatorList } from "../coverage/operator";
import { keyOf, type Resolution } from "../coverage/resolve";
import { ALLOCATOR_CONTAINER, COLLECTOR_CONTAINER, isBatch } from "../coverage/workload-pods";
import type { Command } from "../shared/commands";
import type { InstrumentationLike, WorkloadLike } from "../shared/types";

function rolloutRefusal({ spec }: WorkloadLike): string | undefined {
  if (spec.paused) return "It is paused, so a restart replaces no pod until it is resumed.";
  if (spec.updateStrategy?.type === "OnDelete") {
    return "Its update strategy is OnDelete, so a restart replaces no pod; delete its pods instead.";
  }

  return undefined;
}

/** A sentence; undefined for a row that a restart rolls. */
export function restartRefusal(row: CoverageRow): string | undefined {
  if (row.kind === "CronJob")
    return "A CronJob has no restart; each run's pods are admitted afresh.";
  if (row.kind === "Job") return "A Job has no restart; only a new Job's pods are admitted afresh.";

  switch (row.state) {
    case "restart-needed":
      return rolloutRefusal(row.workload);
    case "injected":
      return row.total === 0 ? "No pods to restart." : "Already injected.";
    case "opted-out":
      return "Opted out.";
    case "unknown":
      if (row.total === 0) return "No pods to restart.";
      if (!row.decisive && row.blockers.every((blocker) => blocker.operator)) {
        return rolloutRefusal(row.workload);
      }

      return `A restart may not help: ${row.verdict.reason}`;
    case "pending":
      return `Not checked yet: ${row.verdict.reason}`;
    default:
      return `A restart would not help: ${(row.decisive?.verdict ?? row.verdict).reason}`;
  }
}

function containersText(names: string[]): string {
  return `${names.length === 1 ? "container" : "containers"} ${names.join(", ")}`;
}

export function restartDetail(row: CoverageRow): string {
  const agents = row.languages.flatMap((language) =>
    language.resolution.kind === "resolved"
      ? [`${language.label} agent from ${keyOf(language.resolution.instrumentation)}`]
      : [],
  );
  const partition = row.workload.spec.updateStrategy?.rollingUpdate?.partition;
  const rolled = partition
    ? `the pods of ${row.kind} ${row.name} from ordinal ${partition} up, as its partition allows`
    : `every pod of ${row.kind} ${row.name}`;

  return `Rolls ${rolled}; the new pods get the ${agents.join(" and ")} in ${containersText(row.containers.names)}.`;
}

const PARTITION_NOTE = "a StatefulSet with a partition rolls only its pods from that ordinal up";

export const BULK_RESTART_DETAIL = `Rolls the pods of each workload below, so the operator's webhook injects the agent into the new ones; ${PARTITION_NOTE}.`;

export const BULK_RESTART_TOOLTIP = `Rolls the pods of each ticked workload a restart would inject, so the webhook injects the agent; ${PARTITION_NOTE}.`;

export const RESTART_HINT =
  "Restart applies to each ticked workload a restart would inject; the rest are listed as skipped, each with why.";

export const RESTART_TOOLTIP = `Rolls its pods so the webhook injects the agent; ${PARTITION_NOTE}. Asks you to type the name`;

export const COPY_ANNOTATION_TOOLTIP =
  "Copies the pod-template annotation to commit to Git; changes nothing in the cluster";

function candidatesComment(resolution: Resolution, instrumentations: InstrumentationLike[]) {
  if (resolution.kind === "ambiguous") {
    return [
      `# one of: ${resolution.candidates.map((name) => `${resolution.namespace}/${name}`).join(", ")}`,
    ];
  }
  if (resolution.kind !== "missing") return [];

  const keys = instrumentations.map(keyOf).sort();

  return [keys.length > 0 ? `# one of: ${keys.join(", ")}` : "# no Instrumentation exists"];
}

/** The block to commit to the pod template: a resolved value is pinned to `namespace/name`. */
export function annotationYaml(row: CoverageRow, instrumentations: InstrumentationLike[]): string {
  const lines = row.languages.flatMap(({ optIn, resolution }) => {
    const value =
      resolution.kind === "resolved"
        ? keyOf(resolution.instrumentation)
        : (optIn.misplaced ?? optIn.value);

    return [
      ...candidatesComment(resolution, instrumentations),
      `${optIn.key}: ${JSON.stringify(value)}`,
    ];
  });

  const path = [
    "spec",
    ...(row.kind === "CronJob" ? ["jobTemplate", "spec"] : []),
    "template",
    "metadata",
    "annotations",
  ];

  return [
    ...path.map((key, depth) => `${"  ".repeat(depth)}${key}:`),
    ...lines.map((line) => `${"  ".repeat(path.length)}${line}`),
  ].join("\n");
}

const WEBHOOK_LOG_LABEL = "What the operator's webhook logged for the namespace";

/** The one Deployment listed, else its pods by label in each namespace, else where it runs. */
function operatorLogCommands(operator: OperatorList | undefined, namespace: string): Command[] {
  const grep = ` | grep '${namespace}'`;
  const items = operator && "items" in operator ? operator.items : [];
  const [only] = items;

  if (only && items.length === 1) {
    const container = managerOf(only)?.name;

    return [
      {
        label: WEBHOOK_LOG_LABEL,
        command: `kubectl logs -n ${only.metadata.namespace} deploy/${only.metadata.name}${container ? ` -c ${container}` : ""}${grep}`,
      },
    ];
  }

  const where = [...new Set(items.map((each) => String(each.metadata.namespace)))].sort();

  if (where.length === 0) {
    return [
      {
        label: "Where the operator runs; its manager container logs the webhook",
        command: `kubectl get deployments -A -l ${OPERATOR_SELECTOR}`,
      },
    ];
  }

  return where.map((each) => ({
    label: where.length === 1 ? WEBHOOK_LOG_LABEL : `${WEBHOOK_LOG_LABEL}, from ${each}`,
    command: `kubectl logs -n ${each} -l ${OPERATOR_SELECTOR} -c manager --prefix${grep}`,
  }));
}

/** `operator` is the list the Coverage rows were judged on; undefined until read. */
export function commandsOf(row: CoverageRow, operator: OperatorList | undefined): Command[] {
  const job = row.kind === "Job" ? row.name : row.run;
  const jobLabels: Record<string, string> = job ? { "batch.kubernetes.io/job-name": job } : {};
  const labels = isBatch(row.kind) ? jobLabels : row.workload.spec.selector?.matchLabels;
  const selector = Object.entries(labels ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const namespaces = new Set(
    row.languages.map(({ resolution }) => {
      if (resolution.kind === "resolved") return String(resolution.instrumentation.getNs());

      return resolution.kind === "off" ? row.namespace : resolution.namespace;
    }),
  );

  return [
    {
      label: "Which agent each pod got",
      command: `kubectl get pods -n ${row.namespace}${selector ? ` -l ${selector}` : ""} -o custom-columns='POD:.metadata.name,INIT:.spec.initContainers[*].name'`,
    },
    ...[...namespaces].map((namespace) => ({
      label: `The Instrumentations in ${namespace}`,
      command: `kubectl get instrumentations.opentelemetry.io -n ${namespace}`,
    })),
    ...operatorLogCommands(operator, row.namespace),
  ];
}

export function collectorCommandsOf(row: CollectorRow): Command[] {
  return [
    ...row.crashes.slice(0, 1).map((crash) => ({
      label: "Why it exits: its previous run's log",
      command: `kubectl logs -n ${row.namespace} ${crash.pod.getName()} -c ${COLLECTOR_CONTAINER} --previous`,
    })),
    ...(row.allocator?.crashes ?? []).slice(0, 1).map((crash) => ({
      label: "Why its target allocator exits: its previous run's log",
      command: `kubectl logs -n ${row.namespace} ${crash.pod.getName()} -c ${ALLOCATOR_CONTAINER} --previous`,
    })),
    {
      label: "Its spec and status",
      command: `kubectl get opentelemetrycollectors.opentelemetry.io -n ${row.namespace} ${row.name} -o yaml`,
    },
  ];
}
