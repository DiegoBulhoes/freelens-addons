import { Renderer } from "@freelensapp/extensions";

import { openPodLog, openTerminal } from "../api/actions";
import { kindOf, type RedisNode } from "../api/nodes";
import { CLUSTER_RESTART_REFUSAL, redisCliCommand } from "../api/operations";
import type { RedisLike } from "../api/types";
import { formatAge } from "../api/verdict";
import { Status } from "../components/status";
import { confirmRestartAll, confirmRestartNode } from "./dialogs";

const {
  Component: { Icon, MenuActions, MenuItem, Notifications, WithTooltip },
} = Renderer;

const ROLE_LABEL = {
  master: "Master",
  replica: "Replica",
  sentinel: "Sentinel",
  standalone: "Standalone",
} as const;

export async function openRedisCli(object: RedisLike, node: RedisNode | undefined) {
  if (!node?.ready) {
    Notifications.error(`${object.getName()} has no ready pod to connect to.`);
    return;
  }

  try {
    await openTerminal(`redis-cli ${node.name}`, redisCliCommand(object, node));
  } catch (error) {
    Notifications.checkedError(error, `Could not open a terminal on ${node.name}`);
  }
}

async function openLog(object: RedisLike, node: RedisNode) {
  try {
    if (!(await openPodLog(object, node))) Notifications.error(`${node.name} has no pod to read.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not open the log of ${node.name}`);
  }
}

// The menu renders outside the drawer. Prevented natively, the drawer ignores the click; the
// React event stays unprevented, so the menu still closes.
function item(icon: string, title: string, tooltip: string, run: () => void) {
  return (
    <MenuItem
      onClick={(event: { nativeEvent: Event }) => {
        event.nativeEvent.preventDefault();
        run();
      }}
    >
      <Icon material={icon} tooltip={tooltip} />
      <span className="title">{title}</span>
    </MenuItem>
  );
}

export function NodesSection({ object, nodes }: { object: RedisLike; nodes: RedisNode[] }) {
  const now = Date.now();
  const restartable = kindOf(object) !== "Cluster";

  return (
    <section className="Redis-section" data-section="redis-nodes">
      <div className="Redis-section__bar">
        <h3 className="Redis-section__title">Pods</h3>
        {restartable && nodes.length > 1 && (
          <WithTooltip tooltip="Restarts the replicas one at a time, then the master. Asks you to type the name">
            <button
              type="button"
              className="Redis-button Redis-button--caution"
              onClick={() => confirmRestartAll(object, nodes)}
            >
              Restart all
            </button>
          </WithTooltip>
        )}
      </div>
      {!restartable && <p className="Redis-hint">No restart here. {CLUSTER_RESTART_REFUSAL}</p>}
      {nodes.length === 0 ? (
        <p className="Redis-section__note">None yet.</p>
      ) : (
        <div className="Redis-list">
          {nodes.map((node) => (
            <div
              key={node.name}
              className={`Redis-row${node.role === "master" ? " Redis-row--info" : node.problem ? " Redis-row--critical" : ""}`}
            >
              <span className="Redis-row__state">{node.role ? ROLE_LABEL[node.role] : "—"}</span>
              <span className="Redis-row__main">
                <span className="Redis-row__name">
                  <b>{node.name}</b>
                  <span className="Redis-row__meta">
                    {[
                      node.group,
                      node.node,
                      node.volume,
                      node.extra ? "left from a scale-down" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="Redis-row__reason">
                  <Status
                    tone={node.ready ? "ok" : "critical"}
                    label={node.ready ? "Ready" : "Not ready"}
                  />
                  {node.upSince && (
                    <span className="Redis-muted">
                      {" "}
                      · up {formatAge(now - Date.parse(node.upSince))}
                    </span>
                  )}
                  {node.restarts > 0 && (
                    <span className="Redis-text--warning">
                      {" "}
                      · {node.restarts} restart{node.restarts === 1 ? "" : "s"}
                    </span>
                  )}
                  {node.problem && <span className="Redis-text--critical"> · {node.problem}</span>}
                </span>
              </span>
              <span className="Redis-row__actions">
                <WithTooltip tooltip={`Opens redis-cli on ${node.name}, in a terminal tab`}>
                  <button
                    type="button"
                    className="Redis-button"
                    disabled={!node.ready}
                    onClick={() => void openRedisCli(object, node)}
                  >
                    redis-cli
                  </button>
                </WithTooltip>
                <MenuActions toolbar={false} autoCloseOnSelect>
                  {item(
                    "subject",
                    "Log",
                    `Opens the log of ${node.name}`,
                    () => void openLog(object, node),
                  )}
                  {restartable &&
                    item(
                      "restart_alt",
                      "Restart",
                      `Deletes ${node.name}'s pod; it comes back on its volume. Asks you to type its name`,
                      () => confirmRestartNode(object, nodes, node.name),
                    )}
                </MenuActions>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
