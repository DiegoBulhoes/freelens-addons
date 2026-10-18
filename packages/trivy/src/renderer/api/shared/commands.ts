import type { ScanState } from "../overview/scan-progress";
import { type CoverageState, isUnjudged } from "../workloads/coverage";
import type { ReportSubject } from "./types";

export interface Command {
  label: string;
  command: string;
}

const OPERATOR_SELECTOR = "app.kubernetes.io/name=trivy-operator";
// A name no label value can hold (a `:`, or past 63 characters) is written as a hash instead.
const LABEL_VALUE = /^(?=.{0,63}$)([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/;

// Where the operator runs is not known here, so the command looks it up itself.
const OPERATOR_NAMESPACE = `"$(kubectl get deployments -A -l ${OPERATOR_SELECTOR} -o jsonpath='{.items[0].metadata.namespace}')"`;

const WHERE_IT_RUNS: Command = {
  label: "Where the operator runs, and whether it is ready",
  command: `kubectl get deployments -A -l ${OPERATOR_SELECTOR}`,
};

const ERRORS_LOGGED: Command = {
  label: "The errors the operator logged",
  command: `kubectl logs -n ${OPERATOR_NAMESPACE} -l ${OPERATOR_SELECTOR} --tail=-1 | grep -i error`,
};

/** The labels the operator writes on a subject's scan Jobs and reports. */
export function subjectSelector(subject: ReportSubject): string {
  return [
    `trivy-operator.resource.kind=${subject.kind}`,
    ...(LABEL_VALUE.test(subject.name) ? [`trivy-operator.resource.name=${subject.name}`] : []),
    `trivy-operator.resource.namespace=${subject.namespace}`,
  ].join(",");
}

export function scanCommandsFor(state: ScanState): Command[] {
  if (state !== "stalled" && state !== "stale") return [];

  return [
    WHERE_IT_RUNS,
    {
      label: "The scan Jobs it is running",
      command: "kubectl get jobs -A -l app.kubernetes.io/managed-by=trivy-operator",
    },
    ERRORS_LOGGED,
  ];
}

// The operator deletes a scan Job once it has read its result, so the log outlasts the Job.
export function workloadCommandsFor(subject: ReportSubject, state: CoverageState): Command[] {
  if (!isUnjudged(state)) return [];

  return [
    {
      label: "Its scan Jobs, while they run",
      command: `kubectl get jobs -A -l ${subjectSelector(subject)}`,
    },
    {
      label: "The reports the operator wrote for it",
      command: `kubectl get vulnerabilityreports,sbomreports,configauditreports -n ${subject.namespace} -l ${subjectSelector(subject)}`,
    },
    ERRORS_LOGGED,
    WHERE_IT_RUNS,
  ];
}
