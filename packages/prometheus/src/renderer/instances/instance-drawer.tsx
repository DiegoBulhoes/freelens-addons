import { observer } from "mobx-react";
import type { InstanceRow } from "../api/instances/instances";
import { instanceFacts } from "../api/shared/facts";
import { commandsFor } from "../api/shared/fixes";
import { ago } from "../api/shared/verdict";
import { CommandsSection } from "../components/commands-section";
import { followLink } from "../components/drawer-link";
import { ObjectFacts } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";
import { Status, type Tone } from "../components/status";

const conditionTone = (status: string): Tone =>
  status === "True" ? "ok" : status === "Degraded" ? "warning" : "critical";

export const InstanceDrawer = observer(
  ({ row, onClose }: { row?: InstanceRow; onClose: () => void }) => {
    const now = Date.now();

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind={row?.kind ?? "Instance"}
        name={row?.name ?? ""}
        onClose={onClose}
        state={row?.verdict}
        section="prometheus-instance"
      >
        {row && (
          <>
            <ObjectFacts
              namespace={row.namespace}
              verdict={row.verdict}
              facts={instanceFacts(row)}
              created={row.object.metadata.creationTimestamp}
              onFollow={(to) => followLink(to, onClose)}
            />

            <section className="Prometheus-section" data-section="prometheus-instance-conditions">
              <h3 className="Prometheus-section__title">Conditions</h3>
              {(row.object.status?.conditions ?? []).length === 0 ? (
                <p className="Prometheus-section__note">The operator has reported none yet.</p>
              ) : (
                <div className="Prometheus-list">
                  {(row.object.status?.conditions ?? []).map((condition) => (
                    <div key={condition.type} className="Prometheus-row">
                      <span className="Prometheus-row__main">
                        <span className="Prometheus-row__name">
                          <Status
                            tone={conditionTone(condition.status)}
                            label={`${condition.type}: ${condition.status}`}
                          />
                          <span className="Prometheus-row__meta">
                            {ago(condition.lastTransitionTime, now)}
                          </span>
                        </span>
                        <span className="Prometheus-row__reason">
                          {condition.message || condition.reason || "No message"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {row.shardStatuses.length > 0 && (
              <section className="Prometheus-section" data-section="prometheus-instance-shards">
                <h3 className="Prometheus-section__title">Shards</h3>
                <div className="Prometheus-list">
                  {row.shardStatuses.map((shard) => (
                    <div
                      key={shard.shardID}
                      className={`Prometheus-row${(shard.unavailableReplicas ?? 0) > 0 ? " Prometheus-row--critical" : ""}`}
                    >
                      <span className="Prometheus-row__main">
                        <span className="Prometheus-row__name">
                          <b>Shard {shard.shardID}</b>
                        </span>
                        <span className="Prometheus-row__reason">
                          {shard.availableReplicas ?? 0} of {shard.replicas ?? 0} available
                          {(shard.updatedReplicas ?? 0) < (shard.replicas ?? 0) &&
                            ` · ${shard.updatedReplicas ?? 0} updated`}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <CommandsSection commands={commandsFor(row)} section="prometheus-instance-commands" />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
