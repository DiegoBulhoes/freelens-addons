// The host's `loadAll` never rejects: a failed load leaves an empty store, which every
// count would read as a healthy cluster. These states tell "unknown" from "none".

export interface StoreFacts {
  /** False until Freelens registers the CRD's API. */
  registered: boolean;
  loaded: boolean;
  failed: boolean;
  itemCount: number;
  gaveUp: boolean;
}

export type OverviewState = "not-installed" | "connecting" | "unreachable" | "ready";

export function getOverviewState(facts: StoreFacts): OverviewState {
  if (!facts.registered) return "not-installed";

  // A later success replaces an earlier failure.
  if (facts.loaded || facts.itemCount > 0) return "ready";

  // Before `failed`: the first attempts routinely fail while the cluster connects.
  if (!facts.gaveUp) return "connecting";

  return "unreachable";
}

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
