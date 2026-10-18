import type { NamespaceLike, WorkloadLike } from "../shared/types";
import { podTemplateOf } from "./workload-pods";

export const PREFIX = "instrumentation.opentelemetry.io/";

export type Language =
  | "java"
  | "nodejs"
  | "python"
  | "dotnet"
  | "go"
  | "apache-httpd"
  | "nginx"
  | "sdk";

export interface LanguageKeys {
  label: string;
  inject: string;
  containerNames: string;
}

const languageKeys = (label: string, inject: string, containerNames: string): LanguageKeys => ({
  label,
  inject: PREFIX + inject,
  containerNames: PREFIX + containerNames,
});

// As internal/instrumentation/annotation.go at v0.158.0 spells them, nginx's list key included.
export const LANGUAGES: Record<Language, LanguageKeys> = {
  java: languageKeys("Java", "inject-java", "java-container-names"),
  nodejs: languageKeys("Node.js", "inject-nodejs", "nodejs-container-names"),
  python: languageKeys("Python", "inject-python", "python-container-names"),
  dotnet: languageKeys(".NET", "inject-dotnet", "dotnet-container-names"),
  go: languageKeys("Go", "inject-go", "go-container-names"),
  "apache-httpd": languageKeys(
    "Apache HTTPD",
    "inject-apache-httpd",
    "apache-httpd-container-names",
  ),
  nginx: languageKeys("NGINX", "inject-nginx", "inject-nginx-container-names"),
  sdk: languageKeys("SDK", "inject-sdk", "sdk-container-names"),
};

export const COMMON_CONTAINER_NAMES = `${PREFIX}container-names`;
export const PYTHON_PLATFORM = `${PREFIX}otel-python-platform`;

const CONTAINER_LIST = /^[a-zA-Z0-9-,]+$/;

export type Source = "pod template" | "Namespace";

export function isTrue(value: string): boolean {
  return value.toLowerCase() === "true";
}

export function isFalse(value: string): boolean {
  return value.toLowerCase() === "false";
}

/** The operator's annotationValue: the pod's and the Namespace's values, in its order. */
export function annotationValue(
  namespaceValue = "",
  podValue = "",
): { value: string; from?: Source } {
  if (!namespaceValue) return { value: podValue, from: podValue ? "pod template" : undefined };
  if (!podValue) return { value: namespaceValue, from: "Namespace" };
  if (!isTrue(podValue)) return { value: podValue, from: "pod template" };
  if (isFalse(namespaceValue)) return { value: "true", from: "pod template" };

  return { value: namespaceValue, from: "Namespace" };
}

export interface OptIn {
  language: Language;
  key: string;
  template?: string;
  namespace?: string;
  /** On the workload's own metadata, which the operator never reads. */
  workload?: string;
  /** What the operator acts on. */
  value: string;
  from?: Source;
  /** The workload's key keeps the agent out: the value it would have on the template. */
  misplaced?: string;
}

export function optInsOf(workload: WorkloadLike, namespace?: NamespaceLike): OptIn[] {
  const template = podTemplateOf(workload).metadata?.annotations ?? {};
  const own = workload.metadata.annotations ?? {};
  const inNamespace = namespace?.metadata.annotations ?? {};

  return (Object.keys(LANGUAGES) as Language[]).flatMap((language) => {
    const key = LANGUAGES[language].inject;
    const values = {
      template: template[key] || undefined,
      namespace: inNamespace[key] || undefined,
      workload: own[key] || undefined,
    };
    // On the template it would beat the Namespace's "false"; a "false" would change nothing.
    const misplaced =
      !values.template &&
      values.workload &&
      !isFalse(values.workload) &&
      (!values.namespace || isFalse(values.namespace))
        ? annotationValue(values.namespace, values.workload).value
        : undefined;

    if (!values.template && !values.namespace && !misplaced) return [];

    return [
      {
        language,
        key,
        ...values,
        ...annotationValue(values.namespace, values.template),
        ...(misplaced ? { misplaced } : {}),
      },
    ];
  });
}

function templateOrNamespaceAnnotation(
  workload: WorkloadLike,
  namespace: NamespaceLike | undefined,
  key: string,
) {
  return (
    podTemplateOf(workload).metadata?.annotations?.[key] ||
    namespace?.metadata.annotations?.[key] ||
    ""
  );
}

export interface Containers {
  names: string[];
  source: "annotation" | "first container";
}

/** The common list, then the language's own; with neither, the first container (sdk.go). */
export function containersFor(
  workload: WorkloadLike,
  language: Language,
  namespace?: NamespaceLike,
): Containers {
  const names = [COMMON_CONTAINER_NAMES, LANGUAGES[language].containerNames]
    .flatMap((key) => templateOrNamespaceAnnotation(workload, namespace, key).split(","))
    .filter(Boolean);

  if (names.length > 0) return { names, source: "annotation" };

  const first = podTemplateOf(workload).spec?.containers?.[0]?.name;

  return { names: first ? [first] : [], source: "first container" };
}

/** Where podmutator.go returns the pod unmutated over its container names. */
export function containerBlockers(
  workload: WorkloadLike,
  languages: Language[],
  namespace?: NamespaceLike,
): string[] {
  const blockers: string[] = [];
  const containerListKeys = [
    COMMON_CONTAINER_NAMES,
    ...Object.values(LANGUAGES).map((each) => each.containerNames),
  ];

  for (const key of containerListKeys) {
    const value = templateOrNamespaceAnnotation(workload, namespace, key);

    if (value && !CONTAINER_LIST.test(value)) {
      blockers.push(`${key} is "${value}", not a comma-separated list of container names`);
    }
  }

  const targets = languages.map((language) => ({
    label: LANGUAGES[language].label,
    containers: containersFor(workload, language, namespace),
  }));

  if (
    targets.length > 1 &&
    targets.some((target) => target.containers.source === "first container")
  ) {
    blockers.push(
      `${targets.map((target) => target.label).join(" and ")} are injected together, so each must name its containers`,
    );
  }

  for (const target of targets) {
    const twice = target.containers.names.find((name, at, all) => all.indexOf(name) !== at);

    if (twice) blockers.push(`${target.label} names container ${twice} twice`);
  }

  return blockers;
}

/** sdk.go at v0.158.0: the init container goes in, but a container it cannot set up is skipped. */
export function pythonBlockers(workload: WorkloadLike, namespace?: NamespaceLike): string[] {
  const { value: platform } = annotationValue(
    namespace?.metadata.annotations?.[PYTHON_PLATFORM],
    podTemplateOf(workload).metadata?.annotations?.[PYTHON_PLATFORM],
  );

  if (platform && platform !== "glibc" && platform !== "musl") {
    return [
      `the platform "${platform}" that ${PYTHON_PLATFORM} names is not glibc or musl, so no container gets the agent`,
    ];
  }

  const targets = containersFor(workload, "python", namespace).names;
  const containers = (podTemplateOf(workload).spec?.containers ?? []).filter((each) =>
    targets.includes(each.name),
  );
  const skipped = containers.filter((each) =>
    (each.env ?? []).some((env) => env.name === "PYTHONPATH" && env.valueFrom),
  );

  if (skipped.length === 0 || skipped.length < containers.length) return [];

  const names = skipped.map((each) => each.name).join(", ");

  return [
    skipped.length === 1
      ? `container ${names} takes PYTHONPATH from valueFrom, so the operator skips it`
      : `containers ${names} take PYTHONPATH from valueFrom, so the operator skips them`,
  ];
}
