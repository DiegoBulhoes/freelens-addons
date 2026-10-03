import { Renderer } from "@freelensapp/extensions";
import type { ClusterPressure } from "../api/cluster-health";

const {
  Component: { Icon },
  Navigation: { navigate },
} = Renderer;

/** Not `showDetails`: the overview does not mount the details drawer. */
function nodeUrl(node: string): string {
  return `/nodes?search=${encodeURIComponent(node)}`;
}

export function ClusterPressureBanner({ pressures }: { pressures: ClusterPressure[] }) {
  if (pressures.length === 0) return null;

  return (
    <div className="ArgoCD-banner">
      <span className="ArgoCD-banner__title">
        <Icon small material="warning" />
        The cluster is under pressure.
      </span>
      <span className="ArgoCD-banner__body">
        Pods may not be scheduling, which ArgoCD reports as Progressing or Degraded without saying
        why.
      </span>
      <div className="ArgoCD-chips">
        {pressures.map((pressure) => {
          const label = (
            <>
              {pressure.node}
              <span className="ArgoCD-chip__meta">{pressure.condition}</span>
            </>
          );

          // selfLink is "" when the event names a node the store does not hold.
          return pressure.selfLink ? (
            <button
              key={`${pressure.node}-${pressure.condition}`}
              type="button"
              className="ArgoCD-chip"
              onClick={() => navigate(nodeUrl(pressure.node))}
              title={`Opens the node in the Nodes list. ${pressure.message ?? ""}`.trim()}
            >
              {label}
            </button>
          ) : (
            <span
              key={`${pressure.node}-${pressure.condition}`}
              className="ArgoCD-chip"
              title={pressure.message}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
