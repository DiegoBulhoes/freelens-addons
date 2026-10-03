import { Application } from "../api/application";
import { ImageUpdater } from "../api/image-updater";
import { scopeKey, withinScope } from "../api/namespace-scope";
import { getOverviewState, type OverviewState } from "../api/store-state";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface ImageUpdaterStores {
  updaters: ImageUpdater[];
  applications: Application[];
  state: OverviewState;
}

export function useImageUpdaterStores(): ImageUpdaterStores {
  const updaterStore = useKubeStore(() => ImageUpdater.getStore<ImageUpdater>());
  const applicationStore = useKubeStore(() => Application.getStore<Application>());
  const scope = useNamespaceScope();
  const gaveUp = useLoadedStores([updaterStore, applicationStore], scopeKey(scope));

  const updaters = withinScope((updaterStore?.items ?? []) as ImageUpdater[], scope);

  return {
    updaters,
    applications: withinScope((applicationStore?.items ?? []) as Application[], scope),
    state: getOverviewState({
      registered: Boolean(updaterStore),
      loaded: Boolean(updaterStore?.isLoaded),
      failed: Boolean(updaterStore?.failedLoading),
      itemCount: updaters.length,
      gaveUp,
    }),
  };
}
