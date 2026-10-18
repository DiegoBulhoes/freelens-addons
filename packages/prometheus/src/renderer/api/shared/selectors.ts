import type { LabelSelector, Labels, MonitorNamespaceSelector } from "./types";

export const namespaceOf = (object: { getNs(): string | undefined }) => object.getNs() ?? "";

export const objectKey = (kind: string, namespace: string | undefined, name: string) =>
  `${kind}/${namespace ?? ""}/${name}`;

/** As metav1.LabelSelectorAsSelector: null or absent selects nothing, `{}` everything. */
export function matchesSelector(
  selector: LabelSelector | null | undefined,
  labels: Labels | undefined,
): boolean {
  if (!selector) return false;

  const have = labels ?? {};

  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (have[key] !== value) return false;
  }

  return (selector.matchExpressions ?? []).every(({ key, operator, values = [] }) => {
    const value = have[key];

    switch (operator) {
      case "In":
        return value !== undefined && values.includes(value);
      case "NotIn":
        return value === undefined || !values.includes(value);
      case "Exists":
        return value !== undefined;
      case "DoesNotExist":
        return value === undefined;
      default:
        // The operator fails to build the selector, so it selects nothing.
        return false;
    }
  });
}

/** A Prometheus's `*NamespaceSelector`: null means only its own namespace, `{}` every namespace. */
export function namespaceMatches(
  selector: LabelSelector | null | undefined,
  objectNamespace: string,
  ownerNamespace: string,
  namespaceLabels: Labels | undefined,
): boolean {
  if (!selector) return objectNamespace === ownerNamespace;

  return matchesSelector(selector, namespaceLabels);
}

/** A TargetAllocator's allowNamespaces and denyNamespaces, which limit its informers. */
export function allowedByLists(
  namespace: string,
  allow: readonly string[] | undefined,
  deny: readonly string[] | undefined,
): boolean {
  if (allow && allow.length > 0 && !allow.includes(namespace)) return false;

  return !deny?.includes(namespace);
}

export type TargetNamespaces = { any: true } | { any: false; names: string[] };

/** Where a monitor looks for Services or pods; the owner's ignoreNamespaceSelectors keeps it home. */
export function monitorTargetNamespaces(
  selector: MonitorNamespaceSelector | undefined,
  monitorNamespace: string,
  ignoreNamespaceSelectors = false,
): TargetNamespaces {
  if (ignoreNamespaceSelectors) return { any: false, names: [monitorNamespace] };
  if (selector?.any) return { any: true };
  if (selector?.matchNames?.length) return { any: false, names: [...selector.matchNames] };

  return { any: false, names: [monitorNamespace] };
}

/** The union over the sources that select it: each one's ignoreNamespaceSelectors applies to itself only. */
export function monitorLooksIn(
  selector: MonitorNamespaceSelector | undefined,
  monitorNamespace: string,
  ignoreFlags: boolean[],
): TargetNamespaces {
  const scopes = (ignoreFlags.length > 0 ? ignoreFlags : [false]).map((ignore) =>
    monitorTargetNamespaces(selector, monitorNamespace, ignore),
  );

  if (scopes.some((scope) => scope.any)) return { any: true };

  return {
    any: false,
    names: [...new Set(scopes.flatMap((scope) => (scope.any ? [] : scope.names)))],
  };
}

export function inTargetNamespaces(namespaces: TargetNamespaces, namespace: string): boolean {
  return namespaces.any || namespaces.names.includes(namespace);
}

/** One line for a selector, as people write it with kubectl -l. */
export function describeSelector(selector: LabelSelector | null | undefined): string {
  if (!selector) return "nothing";

  const parts = [
    ...Object.entries(selector.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`),
    ...(selector.matchExpressions ?? []).map(({ key, operator, values = [] }) => {
      if (operator === "Exists") return key;
      if (operator === "DoesNotExist") return `!${key}`;

      return `${key} ${operator === "NotIn" ? "notin" : "in"} (${values.join(",")})`;
    }),
  ];

  return parts.length > 0 ? parts.join(", ") : "everything";
}
