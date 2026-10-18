import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { containerStatusOf, crashOf } from "../api/collectors/causes";
import { type CollectorRow, isReady } from "../api/collectors/collectors";
import { collectorFacts } from "../api/coverage/facts";
import { ALLOCATOR_CONTAINER, COLLECTOR_CONTAINER } from "../api/coverage/workload-pods";
import {
  collectorWorkloadOf,
  hostListOf,
  LIST_NAMES,
  monitorsListOf,
} from "../api/shared/host-links";
import type { PodLike } from "../api/shared/types";
import { ago, plural } from "../api/shared/verdict";
import { openHostList, openPodLog } from "../api/writes/actions";
import { collectorCommandsOf } from "../api/writes/operations";
import { CommandsSection } from "../components/commands-section";
import { DrawerLink } from "../components/drawer-link";
import { Facts } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";
import { PodName } from "../components/pod-name";
import { Status } from "../components/status";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

async function openLog(pod: PodLike, container: string) {
  try {
    if (!(await openPodLog(pod, container))) {
      Notifications.error(`${pod.getName()} has no ${container} container.`);
    }
  } catch (error) {
    Notifications.checkedError(error, `Could not open the log of ${pod.getName()}`);
  }
}

interface PodRowProps {
  pod: PodLike;
  container: string;
  now: number;
  onLeave: () => void;
}

function PodRow({ pod, container, now, onLeave }: PodRowProps) {
  const status = containerStatusOf(pod, container);
  const ready = isReady(pod);
  const crashing = crashOf(pod, now, container);
  const exit = status?.lastState?.terminated;
  const restarts = status?.restartCount ?? 0;

  return (
    <div
      className={`OpenTelemetry-row${crashing ? " OpenTelemetry-row--critical" : ready ? "" : " OpenTelemetry-row--warning"}`}
    >
      <span className="OpenTelemetry-row__main">
        <PodName pod={pod} now={now} onLeave={onLeave} />
        <span className="OpenTelemetry-row__reason">
          <Status tone={ready ? "ok" : "critical"} label={ready ? "Ready" : "Not ready"} />
          {restarts > 0 && (
            <span className="OpenTelemetry-text--warning"> · {plural(restarts, "restart")}</span>
          )}
          {exit && (
            <span className="OpenTelemetry-muted">
              {" "}
              · last exit code {exit.exitCode ?? "unknown"}
              {exit.reason && ` (${exit.reason})`}, {ago(exit.finishedAt, now)}
            </span>
          )}
        </span>
      </span>
      <span className="OpenTelemetry-row__actions">
        <WithTooltip tooltip={`Opens the log of ${container} in ${pod.getName()}, in a tab`}>
          <button
            type="button"
            className="OpenTelemetry-button"
            onClick={() => void openLog(pod, container)}
          >
            Log
          </button>
        </WithTooltip>
      </span>
    </div>
  );
}

export const CollectorDrawer = observer(
  ({ row, onClose }: { row?: CollectorRow; onClose: () => void }) => {
    const now = Date.now();
    const workload = row && collectorWorkloadOf(row);
    const crdNames = Renderer.K8sApi.crdStore.items.map((crd) => crd.getName());
    const monitors = row && monitorsListOf(row, crdNames);
    const leave = (path: string) => {
      onClose();
      openHostList(path);
    };

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind="OpenTelemetryCollector"
        name={row?.name ?? ""}
        onClose={onClose}
        state={row?.verdict}
        section="opentelemetry-collector"
      >
        {row && (
          <>
            <dl className="OpenTelemetry-facts">
              <dt>Namespace</dt>
              <dd>{row.namespace}</dd>
              <dt>State</dt>
              <dd>
                <Status tone={row.verdict.tone} label={row.verdict.label} />
              </dd>
              <Facts facts={collectorFacts(row)} mono="Image" />
              <dt>Host list</dt>
              <dd>
                <div>
                  <DrawerLink
                    title={`Opens the OpenTelemetry collectors list narrowed to ${row.name}`}
                    onClick={() => leave(hostListOf("OpenTelemetryCollector", row.name))}
                  >
                    {`${row.name} in the OpenTelemetry collectors list`}
                  </DrawerLink>
                </div>
                {workload && (
                  <div>
                    <DrawerLink
                      title={`Opens the ${workload.kind} the operator runs it as, with its events`}
                      onClick={() => leave(hostListOf(workload.kind, workload.name))}
                    >
                      {`${workload.name} in the ${LIST_NAMES[workload.kind]} list`}
                    </DrawerLink>
                  </div>
                )}
              </dd>
              {monitors && (
                <>
                  <dt>Monitors</dt>
                  <dd>
                    <DrawerLink
                      title={`Opens the Prometheus extension's Monitors, searched by ${row.name}`}
                      onClick={() => leave(monitors)}
                    >
                      {`${row.name} in the Prometheus Monitors list`}
                    </DrawerLink>
                  </dd>
                </>
              )}
              <dt>Created</dt>
              <dd>{row.collector.metadata.creationTimestamp ?? "—"}</dd>
            </dl>

            <section className="OpenTelemetry-section" data-section="opentelemetry-collector-pods">
              <h3 className="OpenTelemetry-section__title">Pods</h3>
              {row.pods.length === 0 ? (
                <p className="OpenTelemetry-section__note">
                  {row.mode === "sidecar"
                    ? "No pod in the namespaces in scope carries it as a sidecar."
                    : "None yet."}
                </p>
              ) : (
                <div className="OpenTelemetry-list">
                  {row.pods.map((pod) => (
                    <PodRow
                      key={pod.getName()}
                      pod={pod}
                      container={COLLECTOR_CONTAINER}
                      now={now}
                      onLeave={onClose}
                    />
                  ))}
                </div>
              )}
            </section>

            {row.allocator && (
              <section
                className="OpenTelemetry-section"
                data-section="opentelemetry-collector-allocator"
              >
                <h3 className="OpenTelemetry-section__title">Target allocator pods</h3>
                {row.allocator.pods.length === 0 ? (
                  <p className="OpenTelemetry-section__note">
                    None running, so its prometheus receiver gets no targets.
                  </p>
                ) : (
                  <div className="OpenTelemetry-list">
                    {row.allocator.pods.map((pod) => (
                      <PodRow
                        key={pod.getName()}
                        pod={pod}
                        container={ALLOCATOR_CONTAINER}
                        now={now}
                        onLeave={onClose}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            <CommandsSection
              commands={collectorCommandsOf(row)}
              section="opentelemetry-collector-commands"
            />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
