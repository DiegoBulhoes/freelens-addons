import { AppProject } from "../api/app-project";
import { Application } from "../api/application";
import { scopeKey, withinScope } from "../api/namespace-scope";
import { getOverviewState, type OverviewState } from "../api/store-state";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface ArgoCDStores {
  applications: Application[];
  projects: AppProject[];
  /** `loadAll` swallows failures, so an empty list alone can mean an unreachable cluster. */
  state: OverviewState;
}

export function useArgoCDStores(): ArgoCDStores {
  const applicationStore = useKubeStore(() => Application.getStore<Application>());
  const projectStore = useKubeStore(() => AppProject.getStore<AppProject>());
  const scope = useNamespaceScope();
  const gaveUp = useLoadedStores([applicationStore, projectStore], scopeKey(scope));

  const applications = withinScope((applicationStore?.items ?? []) as Application[], scope);

  return {
    applications,
    projects: withinScope((projectStore?.items ?? []) as AppProject[], scope),
    state: getOverviewState({
      registered: Boolean(applicationStore),
      loaded: Boolean(applicationStore?.isLoaded),
      failed: Boolean(applicationStore?.failedLoading),
      itemCount: applications.length,
      gaveUp,
    }),
  };
}
