import { POD_KIND, REPLICA_SET_KIND } from "../shared/kinds";
import { describeGap, type Failures, unreadIn } from "../shared/store-state";
import { subjectKey } from "../shared/subjects";
import type { ReportSubject, Tone } from "../shared/types";
import type { PodLike } from "./workload-pods";

const IMAGE_BEARING_KINDS = new Set([
  "ReplicaSet",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "Pod",
  "ReplicationController",
]);

export function bearsAnImage(subject: ReportSubject): boolean {
  return IMAGE_BEARING_KINDS.has(subject.kind);
}

export type CoverageState =
  | "scanned"
  // An SBOM exists, but no vulnerability report.
  | "read-but-no-verdict"
  | "never-looked"
  // An unjudged ReplicaSet at zero replicas, or gone: the operator does not scan one.
  | "inactive";

export const COVERAGE_STATUS: Record<CoverageState, { label: string; tone: Tone }> = {
  scanned: { label: "Scanned", tone: "ok" },
  "read-but-no-verdict": { label: "No verdict", tone: "warning" },
  "never-looked": { label: "Not looked at", tone: "critical" },
  inactive: { label: "Scaled away", tone: "info" },
};

export function isUnjudged(state: CoverageState): boolean {
  return state === "never-looked" || state === "read-but-no-verdict";
}

export interface CoverageEntry {
  subject: ReportSubject;
  state: CoverageState;
}

export interface CoverageTally {
  scanned: number;
  readButNoVerdict: number;
  neverLooked: number;
  inactive: number;
  total: number;
}

export interface ReplicaSetLike {
  getName(): string;
  getNs(): string | undefined;
  getOwnerRefs(): { kind?: string; name?: string }[];
  spec?: { replicas?: number };
}

export interface ReplicaSetFacts {
  replicas: number;
  deployment?: string;
}

export interface Running {
  /** Subject keys of the ReplicaSets a pod belongs to. */
  owners: ReadonlySet<string>;
  /** Namespaces whose pods could not be read: nothing there is judged inactive by its pods. */
  unreadIn: ReadonlySet<string>;
  /** The ReplicaSets read, by subject key; without them the pods decide. */
  replicaSets?: ReadonlyMap<string, ReplicaSetFacts>;
  replicaSetsUnreadIn?: ReadonlySet<string>;
}

export interface CoverageInput {
  known: ReportSubject[];
  withSbom: Set<string>;
  withVerdict: Set<string>;
  running?: Running;
}

export function runningOf(
  pods: PodLike[],
  unreadIn: ReadonlySet<string> = new Set(),
  replicaSets?: ReplicaSetLike[],
  replicaSetsUnreadIn: ReadonlySet<string> = new Set(),
): Running {
  const owners = new Set<string>();

  for (const pod of pods) {
    for (const owner of pod.getOwnerRefs()) {
      if (owner.kind !== "ReplicaSet" || !owner.name) continue;

      owners.add(subjectKey({ namespace: pod.getNs() ?? "", kind: owner.kind, name: owner.name }));
    }
  }

  if (!replicaSets) return { owners, unreadIn };

  const facts = new Map<string, ReplicaSetFacts>();

  for (const replicaSet of replicaSets) {
    const key = subjectKey({
      namespace: replicaSet.getNs() ?? "",
      kind: "ReplicaSet",
      name: replicaSet.getName(),
    });
    const deployment = replicaSet.getOwnerRefs().find((owner) => owner.kind === "Deployment")?.name;

    // The API server defaults an unset replicas to 1.
    facts.set(key, { replicas: replicaSet.spec?.replicas ?? 1, deployment });
  }

  return { owners, unreadIn, replicaSets: facts, replicaSetsUnreadIn };
}

function isInactive(subject: ReportSubject, running: Running | undefined): boolean {
  if (!running || subject.kind !== "ReplicaSet") return false;

  const { replicaSets, replicaSetsUnreadIn } = running;

  // One that wants pods it cannot get (quota, admission) is not scaled away.
  if (replicaSets && !replicaSetsUnreadIn?.has(subject.namespace)) {
    return (replicaSets.get(subjectKey(subject))?.replicas ?? 0) === 0;
  }

  if (running.unreadIn.has(subject.namespace)) return false;

  return !running.owners.has(subjectKey(subject));
}

export function coverageStateOf(subject: ReportSubject, input: CoverageInput): CoverageState {
  const key = subjectKey(subject);

  if (input.withVerdict.has(key)) return "scanned";
  if (isInactive(subject, input.running)) return "inactive";
  if (input.withSbom.has(key)) return "read-but-no-verdict";

  return "never-looked";
}

// Deduplicated: the operator writes several report kinds per subject.
export function getCoverage(input: CoverageInput): CoverageEntry[] {
  const seen = new Set<string>();
  const entries: CoverageEntry[] = [];

  for (const subject of input.known) {
    if (!bearsAnImage(subject)) continue;

    const key = subjectKey(subject);

    if (seen.has(key)) continue;

    seen.add(key);
    entries.push({ subject, state: coverageStateOf(subject, input) });
  }

  return entries;
}

export function tallyCoverage(entries: CoverageEntry[]): CoverageTally {
  const counts = {
    scanned: 0,
    readButNoVerdict: 0,
    neverLooked: 0,
    inactive: 0,
    total: entries.length,
  };

  for (const entry of entries) {
    if (entry.state === "scanned") counts.scanned += 1;
    else if (entry.state === "read-but-no-verdict") counts.readButNoVerdict += 1;
    else if (entry.state === "inactive") counts.inactive += 1;
    else counts.neverLooked += 1;
  }

  return counts;
}

// The Deployment controller names each ReplicaSet `<deployment>-<pod-template-hash>`, in this alphabet.
const TEMPLATE_HASH = /^(.+)-[bcdfghjklmnpqrstvwxz2456789]{6,10}$/;

/** The Deployment a ReplicaSet subject belongs to, which is what a user would change. */
export function ownerDeploymentOf(subject: ReportSubject, running?: Running): string | undefined {
  if (subject.kind !== "ReplicaSet") return undefined;

  const known = running?.replicaSets?.get(subjectKey(subject));

  // An Argo Rollouts ReplicaSet has the same name shape, and no Deployment.
  if (known) return known.deployment;

  return TEMPLATE_HASH.exec(subject.name)?.[1];
}

/** Pods decide scaled away only where the ReplicaSets were not read too, so only there is their gap a gap. */
export function workloadGaps(failures: Failures): string[] {
  const pods = unreadIn(failures, POD_KIND);
  const replicaSets = unreadIn(failures, REPLICA_SET_KIND);
  const both = new Set([...pods].filter((namespace) => replicaSets.has(namespace)));
  const onlyReplicaSets = new Set([...replicaSets].filter((namespace) => !pods.has(namespace)));

  return [
    describeGap(
      new Map([[POD_KIND, both]]),
      [POD_KIND],
      "A ReplicaSet there is not taken for scaled away.",
    ),
    describeGap(
      new Map([[REPLICA_SET_KIND, onlyReplicaSets]]),
      [REPLICA_SET_KIND],
      "A ReplicaSet there is judged by its pods.",
    ),
  ].filter((gap) => gap !== undefined);
}
