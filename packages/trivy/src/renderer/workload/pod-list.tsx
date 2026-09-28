import { Renderer } from "@freelensapp/extensions";

import { interestingLabels, type RunningPod } from "../api/workload-pods";

const {
  Navigation: { navigate },
} = Renderer;

/**
 * The host's own Pods page, filtered to this one.
 *
 * Not its details drawer: `showDetails` merges a query parameter into whatever
 * route is current, and the drawer is rendered only on the host's pages, so
 * from an extension page nothing is listening. Landing on Pods with the search
 * filled is one click from the drawer and, unlike a dead button, it works.
 */
function openPod(pod: RunningPod): void {
  navigate(`/pods?search=${encodeURIComponent(pod.name)}`);
}

/** Running is fine, Pending is on its way, anything else is not running. */
const PHASE_TONE: Record<string, string> = {
  Running: "ok",
  Succeeded: "ok",
  Pending: "warning",
};

/**
 * What is actually running. The report names the controller; these are the
 * pods, and one line each says where it is and whether it is up.
 */
export function PodList({ pods }: { pods: RunningPod[] }) {
  return (
    <section className="Trivy-section">
      <h2 className="Trivy-section__title">
        {pods.length === 0 ? "Pods" : `${pods.length} ${pods.length === 1 ? "pod" : "pods"}`}
      </h2>

      {pods.length === 0 ? (
        <p className="Trivy-section__note">
          No pod of this workload is running. The report is about its controller, which can outlive
          its pods.
        </p>
      ) : (
        <div className="Trivy-list">
          {pods.map((pod) => (
            <button
              type="button"
              key={`${pod.namespace}/${pod.name}`}
              className={`Trivy-row Trivy-row--${PHASE_TONE[pod.phase] ?? "critical"}`}
              // The labels are the identity a reader might need but rarely
              // wants on screen; a tooltip keeps the line to one thought.
              title={interestingLabels(pod.labels).join("\n")}
              onClick={() => openPod(pod)}
            >
              <span className="Trivy-row__state">{pod.phase}</span>
              <span className="Trivy-row__main">
                <span className="Trivy-truncate">{pod.name}</span>
              </span>
              <span className="Trivy-row__aside">
                {pod.namespace}
                {pod.node && ` · ${pod.node}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
