import { ApplicationSet } from "../api/application-sets/application-set";
import { Application } from "../api/applications/application";
import type { LoadState } from "../api/shared/store-state";
import { useKubeStore } from "../components/use-kube-store";
import { useScopedStores } from "./use-scoped-stores";

export interface ApplicationSetStores {
  sets: ApplicationSet[];
  applications: Application[];
  state: LoadState;
  applicationsState: LoadState;
  /** The namespaces whose ApplicationSets or Applications were refused, when some answered. */
  gap?: string;
}

const KINDS = { ApplicationSet: "ApplicationSets", Application: "Applications" } as const;

export function useApplicationSetStores(): ApplicationSetStores {
  const setStore = useKubeStore(() => ApplicationSet.getStore<ApplicationSet>());
  const applicationStore = useKubeStore(() => Application.getStore<Application>());

  const { primaryItems, secondaryItems, state, secondaryState, gap } = useScopedStores<
    ApplicationSet,
    Application
  >(
    { kind: "ApplicationSet", store: setStore },
    { kind: "Application", store: applicationStore },
    KINDS,
    // A set's row counts its Applications: both must be this scope's.
    [setStore, applicationStore],
  );

  return {
    sets: primaryItems,
    applications: secondaryItems,
    state,
    applicationsState: secondaryState,
    gap,
  };
}
