import type { DrawerState } from "../api/shared/drawer-state";

export interface DrawerStateProps {
  state?: DrawerState;
}

/** A warning or worse is a banner; anything calmer is one muted line. */
export function StateBanner({ state }: DrawerStateProps) {
  if (!state) return null;

  if (state.tone === "ok" || state.tone === "info") {
    return <p className="ArgoCD-muted">{state.reason}</p>;
  }

  return (
    <div className={`ArgoCD-banner${state.tone === "critical" ? " ArgoCD-banner--critical" : ""}`}>
      <div className="ArgoCD-banner__title">{state.label}</div>
      <div className="ArgoCD-banner__body">{state.reason}</div>
    </div>
  );
}
