/**
 * Whether the overview knows anything, and whether it should say so.
 *
 * The host's `loadAll` never rejects. It catches, calls `resetOnError` — which
 * empties the store and sets `isLoaded` false — and sets `failedLoading`. An
 * unreachable cluster therefore leaves a store that exists and holds nothing,
 * which every count on the page reads as a cluster with nothing wrong.
 *
 * The distinction this makes is between not knowing and knowing there is
 * nothing. Only the second is worth a quiet page.
 */

export interface StoreFacts {
  /** False until Freelens registers the CRD's API, which is what "no ArgoCD here" looks like. */
  registered: boolean;
  loaded: boolean;
  failed: boolean;
  itemCount: number;
  /** True once the retry budget is spent, so a slow connect is not called a failure. */
  gaveUp: boolean;
}

export type OverviewState =
  /** No CRD: this cluster does not run ArgoCD, and that is not an error. */
  | "not-installed"
  /** A load is still in flight or still being retried. */
  | "connecting"
  /** Loading finished and failed, or ran out of retries with nothing to show. */
  | "unreachable"
  /** The counts on the page mean what they say. */
  | "ready";

export function getOverviewState(facts: StoreFacts): OverviewState {
  if (!facts.registered) return "not-installed";

  // Loaded wins over failed: a later success replaces an earlier failure, and a
  // store holding items is one that answered.
  if (facts.loaded || facts.itemCount > 0) return "ready";

  // Ordered before `failed` on purpose. The first attempts routinely fail while
  // the cluster connects, which is the whole reason the retry budget exists;
  // calling that unreachable would light an alarm on every normal startup.
  if (!facts.gaveUp) return "connecting";

  return "unreachable";
}

/**
 * The headline. Every branch that states a number is reachable only from
 * `ready`: an empty store is "none found" when the cluster answered and said
 * so, and something else entirely when it never answered.
 */
export function describeHeadline(
  state: OverviewState,
  needingAttention: number,
  total: number,
): string {
  if (state === "not-installed") return "No ArgoCD Applications found";
  if (state === "connecting") return "Looking for ArgoCD…";
  if (state === "unreachable") return "Cannot read the ArgoCD Applications";

  if (total === 0) return "No ArgoCD Applications found";
  if (needingAttention === 0) return `All ${total} Applications are synced and healthy`;

  return `${needingAttention} of ${total} Applications need attention`;
}

/** What the page says instead of a count it cannot stand behind. */
export function describeOverviewState(state: OverviewState): string | undefined {
  if (state === "not-installed") {
    return "No ArgoCD Applications are registered in this cluster.";
  }

  if (state === "connecting") return "Connecting to the cluster…";

  if (state === "unreachable") {
    return "Could not read the ArgoCD Applications, so what is below may be incomplete.";
  }

  return undefined;
}
