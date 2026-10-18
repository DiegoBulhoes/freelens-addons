import { Application } from "../api/applications/application";
import { AppProject } from "../api/projects/app-project";
import type { LoadState } from "../api/shared/store-state";
import { useKubeStore } from "../components/use-kube-store";
import { useScopedStores } from "./use-scoped-stores";

export interface ArgoCDStores {
  applications: Application[];
  projects: AppProject[];
  /** `loadAll` swallows failures, so an empty list alone can mean an unreachable cluster. */
  state: LoadState;
  /** The namespaces whose Applications or projects were refused, when some answered. */
  gap?: string;
}

const ARGOCD_KINDS = { Application: "Applications", AppProject: "AppProjects" } as const;

export function useArgoCDStores(): ArgoCDStores {
  const applicationStore = useKubeStore(() => Application.getStore<Application>());
  const projectStore = useKubeStore(() => AppProject.getStore<AppProject>());

  const { primaryItems, secondaryItems, state, gap } = useScopedStores<Application, AppProject>(
    { kind: "Application", store: applicationStore },
    { kind: "AppProject", store: projectStore },
    ARGOCD_KINDS,
    [applicationStore],
  );

  return { applications: primaryItems, projects: secondaryItems, state, gap };
}
