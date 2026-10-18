import type { ReportSubject } from "./types";

// The operator names the subject in labels, not ownerReferences.

const SUBJECT_LABELS = {
  namespace: "trivy-operator.resource.namespace",
  kind: "trivy-operator.resource.kind",
  name: "trivy-operator.resource.name",
  // Written instead of `name` past the 63-character label limit; the name is then only in ownerReferences.
  nameHash: "trivy-operator.resource.name-hash",
  container: "trivy-operator.container.name",
} as const;

// Split on the first `=` only: a label value may contain one.
export function subjectFromLabels(labels: string[], ownerName?: string): ReportSubject | undefined {
  const found: Record<string, string> = {};

  for (const label of labels) {
    const separator = label.indexOf("=");

    if (separator > 0) found[label.slice(0, separator)] = label.slice(separator + 1);
  }

  // Empty, not absent, for a cluster-scoped subject.
  const namespace = found[SUBJECT_LABELS.namespace];
  const kind = found[SUBJECT_LABELS.kind];
  // The owner is trusted only when the name was hashed away.
  const name =
    found[SUBJECT_LABELS.name] ?? (found[SUBJECT_LABELS.nameHash] ? ownerName : undefined);

  // Never derived from the report's own name: the operator did not claim it.
  if (namespace === undefined || !kind || !name) return undefined;

  return { namespace, kind, name };
}

export interface SubjectBearing {
  getLabels(): string[];
  getOwnerRefs(): { name: string }[];
}

export function subjectOf(object: SubjectBearing): ReportSubject | undefined {
  return subjectFromLabels(object.getLabels(), object.getOwnerRefs()[0]?.name);
}

// The body is `report`, beside `metadata`, so it fits neither status nor spec.
export interface Reporting<Body> extends SubjectBearing {
  report?: Body;
}

export function containerOf(object: SubjectBearing): string | undefined {
  const prefix = `${SUBJECT_LABELS.container}=`;

  for (const label of object.getLabels()) {
    if (label.startsWith(prefix)) return label.slice(prefix.length);
  }

  return undefined;
}

export function subjectKey(subject: ReportSubject): string {
  return `${subject.namespace}/${subject.kind}/${subject.name}`;
}
