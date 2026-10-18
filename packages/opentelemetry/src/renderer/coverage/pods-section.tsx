import type { CoverageRow } from "../api/coverage/coverage";
import { PodName } from "../components/pod-name";

export function PodsSection({ row, onLeave }: { row: CoverageRow; onLeave: () => void }) {
  const now = Date.now();
  // Opted out, a pod without the agent is what was asked for.
  const wanted = row.state !== "opted-out";

  return (
    <section className="OpenTelemetry-section" data-section="opentelemetry-pods">
      <h3 className="OpenTelemetry-section__title">Pods</h3>
      {row.pods.length === 0 ? (
        <p className="OpenTelemetry-section__note">
          None running. The webhook decides when the next one is admitted.
        </p>
      ) : (
        <div className="OpenTelemetry-list">
          {row.pods.map(({ pod, injected, agents, containers }) => (
            <div
              key={pod.getName()}
              className={`OpenTelemetry-row${!injected && wanted ? " OpenTelemetry-row--warning" : ""}`}
            >
              <span className="OpenTelemetry-row__state">
                {injected ? "Injected" : "Not injected"}
              </span>
              <span className="OpenTelemetry-row__main">
                <PodName pod={pod} now={now} onLeave={onLeave} />
                <span className="OpenTelemetry-row__reason">
                  {injected
                    ? [
                        agents.length > 0 ? `Agent from ${agents.join(", ")}` : undefined,
                        containers.length > 0
                          ? `OTEL_* set in ${containers.join(", ")}`
                          : "no container carries OTEL_*",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "No agent container and no OTEL_* settings."}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
