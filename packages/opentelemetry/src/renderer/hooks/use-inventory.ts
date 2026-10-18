import {
  type CollectorRow,
  collectorBases,
  crashingPods,
  judgeCollectors,
} from "../api/collectors/collectors";
import {
  type CoverageInventory,
  type CoverageRow,
  coverageRows,
  lookupNamespaces,
  withReferences,
} from "../api/coverage/coverage";
import { type OperatorList, operatorVersions } from "../api/coverage/operator";
import { useCollectorCauses } from "./use-collector-causes";
import { useOperator } from "./use-operator";
import { type OtelStores, useOtelStores } from "./use-otel-stores";
import { useReferenceNames } from "./use-reference-names";

export interface OtelInventory {
  stores: OtelStores;
  coverage: CoverageRow[];
  collectors: CollectorRow[];
  /** The operator's Deployments the Coverage rows were judged on. */
  operator?: OperatorList;
}

/** Builds only the rows the page shows; the Collectors rows read crashing pods' logs. */
export function useInventory({
  collectors,
  coverage,
}: {
  collectors: boolean;
  coverage: boolean;
}): OtelInventory {
  const stores = useOtelStores();
  const operator = useOperator(coverage, operatorVersions(stores.workloads));
  const inventory: CoverageInventory = {
    workloads: stores.workloads,
    pods: stores.pods,
    namespaces: stores.namespaces,
    instrumentations: stores.instrumentations,
    collectors: stores.everyCollector,
    gaveUp: stores.gaveUp,
    operator,
  };
  const firstPass = coverage ? coverageRows(inventory) : [];
  const namespacesToLook = lookupNamespaces(firstPass);
  const references = useReferenceNames(namespacesToLook);
  const bases = collectors ? collectorBases(stores.collectors, stores.pods, Date.now()) : [];
  const causes = useCollectorCauses(crashingPods(bases));

  return {
    stores,
    coverage: withReferences(firstPass, { ...inventory, references }),
    collectors: judgeCollectors(bases, causes),
    operator,
  };
}
