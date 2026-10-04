import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { masterOf, type RedisNode } from "../api/nodes";
import { commandsOf } from "../api/operations";
import type { RedisRow } from "../api/rows";
import type { EventLike } from "../api/types";
import { connectionUrls, describeTls, eventsOf, eventTime } from "../api/upkeep";
import { ago } from "../api/verdict";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import { confirmFailover, confirmScale } from "./dialogs";
import { NodesSection, openRedisCli } from "./nodes-section";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

const SHOWN_WARNINGS = 8;

async function copy(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    Notifications.ok(`${label} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy ${label.toLowerCase()}`);
  }
}

interface RedisDrawerProps {
  row?: RedisRow;
  /** Every row, to find the pods of a replication's sentinel. */
  rows: RedisRow[];
  events: EventLike[];
  onClose: () => void;
}

export const RedisDrawer = observer(({ row, rows, events, onClose }: RedisDrawerProps) => {
  const object = row?.object;
  const now = Date.now();
  const warnings = object ? eventsOf(events, object) : [];
  const sentinelRow =
    row?.kind === "Replication"
      ? rows.find((each) => row.related.includes(each.object))
      : undefined;
  const target: RedisNode | undefined = row
    ? (masterOf(row.nodes) ?? row.nodes.find((each) => each.ready))
    : undefined;

  return (
    <ObjectDrawer
      open={Boolean(row)}
      kind={row?.kind ?? "Redis"}
      name={object?.getName() ?? ""}
      onClose={onClose}
      state={row?.health}
      section="redis-object"
      actions={
        object && row
          ? [
              {
                icon: "terminal",
                title: `Opens redis-cli on ${target?.name ?? "a pod"}, in a terminal tab`,
                onClick: () => void openRedisCli(object, target),
              },
              ...(row.kind === "Replication"
                ? [
                    {
                      icon: "swap_horiz",
                      title: "Asks its sentinels to promote a replica. Asks you to type the name",
                      onClick: () =>
                        confirmFailover(
                          object,
                          row.nodes,
                          sentinelRow?.object,
                          sentinelRow?.nodes ?? [],
                        ),
                    },
                  ]
                : []),
              ...(row.kind !== "Standalone"
                ? [
                    {
                      icon: "unfold_more",
                      title: "Changes how many pods it has. Asks first",
                      onClick: () => confirmScale(object),
                    },
                  ]
                : []),
            ]
          : []
      }
    >
      {object && row && (
        <>
          <dl className="Redis-facts">
            <dt>Kind</dt>
            <dd>{row.kind}</dd>
            <dt>Namespace</dt>
            <dd>{object.getNs()}</dd>
            <dt>State</dt>
            <dd>
              <Status tone={row.health.tone} label={row.health.label} />
            </dd>
            {row.kind === "Replication" && (
              <>
                <dt>Master</dt>
                <dd>{masterOf(row.nodes)?.name ?? "—"}</dd>
                <dt>Sentinels</dt>
                <dd>
                  {row.related.length > 0
                    ? row.related.map((each) => each.getName()).join(", ")
                    : "None: nothing fails it over"}
                </dd>
              </>
            )}
            {row.kind === "Sentinel" && (
              <>
                <dt>Watches</dt>
                <dd>{object.spec.redisSentinelConfig?.redisReplicationName ?? "—"}</dd>
                <dt>Quorum</dt>
                <dd>{object.spec.redisSentinelConfig?.quorum ?? "—"}</dd>
              </>
            )}
            {row.kind === "Cluster" && (
              <>
                <dt>Operator says</dt>
                <dd>{object.status?.reason ?? "—"}</dd>
              </>
            )}
            <dt>Image</dt>
            <dd className="Redis-mono">{object.spec.kubernetesConfig?.image ?? "—"}</dd>
            <dt>Password</dt>
            <dd>
              {object.spec.kubernetesConfig?.redisSecret?.name
                ? `From Secret ${object.spec.kubernetesConfig.redisSecret.name}`
                : "None"}
            </dd>
            <dt>TLS</dt>
            <dd>{describeTls(row.tls)}</dd>
            {connectionUrls(object).map(({ label, url }) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd>
                  <span className="Redis-copyable">
                    <code className="Redis-mono">{url}</code>
                    <WithTooltip tooltip="Copies the URL, without the password; the command for the password is under Look further">
                      <button
                        type="button"
                        className="Redis-button"
                        onClick={() => void copy(`${label} URL`, url)}
                      >
                        Copy
                      </button>
                    </WithTooltip>
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          <NodesSection object={object} nodes={row.nodes} />

          <section className="Redis-section" data-section="redis-warnings">
            <h3 className="Redis-section__title">Recent warnings</h3>
            {warnings.length === 0 ? (
              <p className="Redis-section__note">
                No warning events for it, its pods or its volumes.
              </p>
            ) : (
              <div className="Redis-list">
                {warnings.slice(0, SHOWN_WARNINGS).map((event) => (
                  <div key={event.getName()} className="Redis-row Redis-row--warning">
                    <span className="Redis-row__main">
                      <span className="Redis-row__name">
                        <b>{event.reason ?? "Warning"}</b>
                        <span className="Redis-row__meta">
                          {event.involvedObject.kind} {event.involvedObject.name}
                          {(event.count ?? 1) > 1 && ` · ${event.count} times`}
                        </span>
                      </span>
                      <span className="Redis-row__reason">{event.message}</span>
                    </span>
                    <span className="Redis-row__aside">{ago(eventTime(event), now)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="Redis-section" data-section="redis-commands">
            <h3 className="Redis-section__title">Look further</h3>
            <div className="Redis-list">
              {commandsOf(object).map(({ label, command }) => (
                <div key={label} className="Redis-row">
                  <span className="Redis-row__main">
                    <span className="Redis-row__name">{label}</span>
                    <code className="Redis-row__reason">{command}</code>
                  </span>
                  <span className="Redis-row__actions">
                    <WithTooltip tooltip="Copies the command, to paste into a terminal">
                      <button
                        type="button"
                        className="Redis-button"
                        onClick={() => void copy(label, command)}
                      >
                        Copy
                      </button>
                    </WithTooltip>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </ObjectDrawer>
  );
});
