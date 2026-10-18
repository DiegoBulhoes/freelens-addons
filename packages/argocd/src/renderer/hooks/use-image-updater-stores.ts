import { Application } from "../api/applications/application";
import { ImageUpdater } from "../api/image-updater/image-updater";
import type { LoadState } from "../api/shared/store-state";
import { useKubeStore } from "../components/use-kube-store";
import { useScopedStores } from "./use-scoped-stores";

export interface ImageUpdaterStores {
  updaters: ImageUpdater[];
  applications: Application[];
  state: LoadState;
  /** The namespaces whose rules or Applications were refused, when some answered. */
  gap?: string;
}

const KINDS = { ImageUpdater: "ImageUpdater rules", Application: "Applications" } as const;

export function useImageUpdaterStores(): ImageUpdaterStores {
  const updaterStore = useKubeStore(() => ImageUpdater.getStore<ImageUpdater>());
  const applicationStore = useKubeStore(() => Application.getStore<Application>());

  const { primaryItems, secondaryItems, state, gap } = useScopedStores<ImageUpdater, Application>(
    { kind: "ImageUpdater", store: updaterStore },
    { kind: "Application", store: applicationStore },
    KINDS,
    // A rule's health reads its Applications: both must be this scope's.
    [updaterStore, applicationStore],
  );

  return { updaters: primaryItems, applications: secondaryItems, state, gap };
}
