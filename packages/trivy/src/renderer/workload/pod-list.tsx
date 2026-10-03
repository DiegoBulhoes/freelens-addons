import { Renderer } from "@freelensapp/extensions";

import { interestingLabels, type RunningPod } from "../api/workload-pods";

const {
  Navigation: { navigate },
} = Renderer;

// Not showDetails: the drawer is not rendered on an extension page.
function openPod(pod: RunningPod): void {
  navigate(`/pods?search=${encodeURIComponent(pod.name)}`);
}

const PHASE_TONE: Record<string, string> = {
  Running: "ok",
  Succeeded: "ok",
  Pending: "warning",
};

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
              title={[
                "Opens the Pods list, narrowed to this pod",
                ...interestingLabels(pod.labels),
              ].join("\n")}
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
