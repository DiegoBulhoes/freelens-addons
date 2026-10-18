import type { InstrumentationLike } from "../shared/types";
import { isFalse, isTrue } from "./annotations";

export type Resolution =
  | { kind: "off" }
  | {
      kind: "resolved";
      instrumentation: InstrumentationLike;
      by: "only one in the namespace" | "name";
    }
  | { kind: "missing"; namespace: string; name?: string }
  | { kind: "unread"; namespace: string }
  | { kind: "ambiguous"; namespace: string; candidates: string[] };

export function keyOf(object: { getName(): string; getNs(): string | undefined }): string {
  return `${object.getNs() ?? ""}/${object.getName()}`;
}

/** As podmutator.go getInstrumentationInstance (v0.158.0); `instrumentations` undefined until all are read. */
export function resolveInstrumentation(
  value: string,
  podNamespace: string,
  instrumentations: InstrumentationLike[] | undefined,
): Resolution {
  if (!value || isFalse(value)) return { kind: "off" };

  if (isTrue(value)) {
    if (!instrumentations) return { kind: "unread", namespace: podNamespace };

    const here = instrumentations.filter((each) => each.getNs() === podNamespace);
    const [only] = here;

    if (!only) return { kind: "missing", namespace: podNamespace };
    if (here.length > 1) {
      return {
        kind: "ambiguous",
        namespace: podNamespace,
        candidates: here.map((each) => each.getName()).sort(),
      };
    }

    return { kind: "resolved", instrumentation: only, by: "only one in the namespace" };
  }

  const slash = value.indexOf("/");
  const namespace = slash < 0 ? podNamespace : value.slice(0, slash);
  const name = value.slice(slash + 1);

  if (!instrumentations) return { kind: "unread", namespace };

  const found = instrumentations.find(
    (each) => each.getNs() === namespace && each.getName() === name,
  );

  return found
    ? { kind: "resolved", instrumentation: found, by: "name" }
    : { kind: "missing", namespace, name };
}
