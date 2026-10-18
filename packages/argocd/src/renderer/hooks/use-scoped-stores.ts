import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import {
  describeFailures,
  type LoadState,
  loadedForScope,
  loadState,
  refusedEverywhere,
} from "../api/shared/store-state";
import { type LoadableStore, useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

interface ScopedStore extends LoadableStore {
  readonly items: readonly unknown[];
}

interface ScopedEntry {
  kind: string;
  store?: ScopedStore;
}

type Scoped = { getNs(): string | undefined };

export interface ScopedStores<Primary, Secondary> {
  primaryItems: Primary[];
  secondaryItems: Secondary[];
  state: LoadState;
  /** The secondary kind's own state: its items alone say nothing while it is refused or pending. */
  secondaryState: LoadState;
  gap?: string;
}

/** The state follows the primary kind; `loadedStores` are the stores that must be loaded for the scope before it is ready. */
export function useScopedStores<Primary extends Scoped, Secondary extends Scoped>(
  primary: ScopedEntry,
  secondary: ScopedEntry,
  kinds: Readonly<Record<string, string>>,
  loadedStores: readonly (ScopedStore | undefined)[],
): ScopedStores<Primary, Secondary> {
  const scope = useNamespaceScope();
  const key = scopeKey(scope);
  const { gaveUp, loadedFor, failures } = useLoadedStores([primary, secondary], key);

  const primaryItems = withinScope((primary.store?.items ?? []) as Primary[], scope);
  const secondaryItems = withinScope((secondary.store?.items ?? []) as Secondary[], scope);

  return {
    primaryItems,
    secondaryItems,
    state: loadState({
      registered: Boolean(primary.store),
      loaded: loadedForScope(loadedStores, loadedFor, key),
      refused: refusedEverywhere(failures, primary.kind, scope),
      itemCount: primaryItems.length,
      gaveUp,
    }),
    secondaryState: loadState({
      registered: Boolean(secondary.store),
      loaded: loadedForScope([secondary.store], loadedFor, key),
      refused: refusedEverywhere(failures, secondary.kind, scope),
      itemCount: secondaryItems.length,
      gaveUp,
    }),
    gap: describeFailures(failures, kinds),
  };
}
