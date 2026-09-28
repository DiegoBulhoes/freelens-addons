import type { ReportSubject } from "./types";

/**
 * Which cluster object a report is about.
 *
 * The operator records this in labels rather than in ownerReferences, which is
 * what makes a report joinable to reports of other kinds — and what lets a
 * report outlive the ReplicaSet it describes.
 */

const SUBJECT_LABELS = {
  namespace: "trivy-operator.resource.namespace",
  kind: "trivy-operator.resource.kind",
  name: "trivy-operator.resource.name",
  /**
   * Written instead of `name` when the subject's name does not fit a label
   * value. Seen on a real cluster with a 64-character StatefulSet PVC, one
   * character over the 63 a label allows; the name itself is then only in the
   * report's ownerReferences.
   */
  nameHash: "trivy-operator.resource.name-hash",
} as const;

/**
 * `getLabels()` hands back `key=value` strings, so these are parsed rather than
 * indexed. Splitting on the first `=` only: a label value may contain one.
 */
export function subjectFromLabels(labels: string[], ownerName?: string): ReportSubject | undefined {
  const found: Record<string, string> = {};

  for (const label of labels) {
    const separator = label.indexOf("=");

    if (separator > 0) found[label.slice(0, separator)] = label.slice(separator + 1);
  }

  // Present but empty for a cluster-scoped subject such as a ClusterRole, so
  // this checks the label exists rather than that it holds something.
  const namespace = found[SUBJECT_LABELS.namespace];
  const kind = found[SUBJECT_LABELS.kind];
  // The owner is only consulted when the name was hashed away: it is the same
  // object in that case, and trusting it unconditionally would let a report
  // whose labels say nothing be attributed to whatever owns it.
  const name =
    found[SUBJECT_LABELS.name] ?? (found[SUBJECT_LABELS.nameHash] ? ownerName : undefined);

  // A report that cannot say what it is about cannot be joined to anything, and
  // deriving a subject from the report's own name would invent one the operator
  // never claimed.
  if (namespace === undefined || !kind || !name) return undefined;

  return { namespace, kind, name };
}

/** What subjectOf needs of a report: the host's KubeObject satisfies it, and so does a fixture. */
export interface SubjectBearing {
  getLabels(): string[];
  getOwnerRefs(): { name: string }[];
}

export function subjectOf(object: SubjectBearing): ReportSubject | undefined {
  return subjectFromLabels(object.getLabels(), object.getOwnerRefs()[0]?.name);
}

/** Which container of the workload a report covers; one report is written per container. */
export function containerOf(object: SubjectBearing): string | undefined {
  for (const label of object.getLabels()) {
    if (label.startsWith(`${CONTAINER_LABEL}=`)) return label.slice(CONTAINER_LABEL.length + 1);
  }

  return undefined;
}

const CONTAINER_LABEL = "trivy-operator.container.name";

/** One subject as a string, so reports of different kinds can be matched on it. */
export function subjectKey(subject: ReportSubject): string {
  return `${subject.namespace}/${subject.kind}/${subject.name}`;
}
