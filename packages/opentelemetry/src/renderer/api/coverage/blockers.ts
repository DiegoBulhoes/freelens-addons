import type {
  CollectorLike,
  InstrumentationLike,
  NamespaceLike,
  WorkloadLike,
} from "../shared/types";
import { annotationValue, isFalse, isTrue } from "./annotations";
import type { ReferenceNames } from "./reference-names";
import { keyOf } from "./resolve";
import { podTemplateOf } from "./workload-pods";

/** Why the operator would admit a pod without the agent; `certain` is false when it could not be checked. */
export interface Blocker {
  certain: boolean;
  text: string;
  /** Uncertain until the Secret and ConfigMap names in the pod's namespace are listed. */
  awaitsNames?: boolean;
  /** Not read yet, rather than refused: the row reads Checking, not Unknown. */
  pending?: boolean;
  /** True of admitted pods too: they got the init container, and no container got the agent. */
  hollow?: boolean;
  /** From the operator's Deployment, a cluster-wide list a namespaced viewer may not be allowed. */
  operator?: boolean;
}

/** podmutator.go validateInstrumentation: the TLS Secret and ConfigMap are looked up in the pod's namespace. */
export function tlsBlockers(
  instrumentation: InstrumentationLike,
  podNamespace: string,
  references: ReferenceNames = {},
): Blocker[] {
  const tls = instrumentation.spec.exporter?.tls;
  const named = [
    { kind: "Secret", name: tls?.secretName, known: references.secrets },
    { kind: "ConfigMap", name: tls?.configMapName, known: references.configMaps },
  ];

  return named.flatMap(({ kind, name, known }): Blocker[] => {
    if (!name) return [];

    const what = `the TLS ${kind} ${name} named by ${keyOf(instrumentation)}`;
    const listing = known?.get(podNamespace);

    if (!listing) {
      return [
        {
          certain: false,
          awaitsNames: true,
          pending: true,
          text: `${what} is not looked up in ${podNamespace} yet`,
        },
      ];
    }
    if ("error" in listing) {
      return [
        {
          certain: false,
          awaitsNames: true,
          text: `${what} could not be looked up in ${podNamespace} (${listing.error})`,
        },
      ];
    }
    if (listing.has(`${podNamespace}/${name}`)) return [];

    return [{ certain: true, text: `${what} is not in ${podNamespace}` }];
  });
}

export const SIDECAR_INJECT = "sidecar.opentelemetry.io/inject";

/** pkg/sidecar at v0.158.0: a named collector not found fails the webhook, so no agent goes in. */
export function sidecarBlockers(
  workload: WorkloadLike,
  namespace: NamespaceLike | undefined,
  collectors: CollectorLike[] | undefined,
  gaveUp = false,
): Blocker[] {
  const { value } = annotationValue(
    namespace?.metadata.annotations?.[SIDECAR_INJECT],
    podTemplateOf(workload).metadata?.annotations?.[SIDECAR_INJECT],
  );

  // Every other failure, "true" with no collector included, is only logged and the agent still goes in.
  if (!value || isTrue(value) || isFalse(value)) return [];

  const named = value.includes("/") ? value : `${String(workload.getNs())}/${value}`;
  const what = `the collector ${named} that ${SIDECAR_INJECT} names`;

  if (!collectors) {
    return gaveUp
      ? [{ certain: false, text: `${what} could not be looked up` }]
      : [{ certain: false, pending: true, text: `${what} is not looked up yet` }];
  }
  if (collectors.some((collector) => keyOf(collector) === named)) return [];

  return [{ certain: true, text: `${what} does not exist, so the webhook adds nothing` }];
}
