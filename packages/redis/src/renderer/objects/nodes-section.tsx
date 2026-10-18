import { Renderer } from "@freelensapp/extensions";
import { Fragment, type ReactNode } from "react";
import { kindOf, type RedisNode } from "../api/objects/nodes";
import type { RedisLike } from "../api/shared/types";
import { formatAge, plural } from "../api/shared/verdict";
import { openPodLog, openTerminal } from "../api/writes/actions";
import { CLUSTER_RESTART_REFUSAL, redisCliCommand } from "../api/writes/operations";
import { HostLink } from "../components/drawer-link";
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
function menuItem(icon: string, title: string, tooltip: string, run: () => void) {
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

function NodeMeta({ node, onClose }: { node: RedisNode; onClose: () => void }) {
  const parts = [
    ["group", node.group],
    ["node", node.node && <HostLink kind="Node" name={node.node} onClose={onClose} />],
    [
      "claim",
      node.claim && (
        <HostLink
          kind="PersistentVolumeClaim"
          name={node.claim}
          label={node.volume ?? node.claim}
          onClose={onClose}
        />
      ),
    ],
    ["extra", node.extra && "left from a scale-down"],
  ] as [string, ReactNode][];

  return (
    <span className="Redis-row__meta">
      {parts
        .filter(([, part]) => Boolean(part))
        .map(([key, part], at) => (
          <Fragment key={key}>
            {at > 0 && " · "}
            {part}
          </Fragment>
        ))}
    </span>
  );
}

function NodeRow({
  object,
  node,
  nodes,
  unread,
  restartable,
  now,
  onClose,
}: {
  object: RedisLike;
  node: RedisNode;
  nodes: RedisNode[];
  unread?: string;
  restartable: boolean;
  now: number;
  onClose: () => void;
}) {
  return (
    <div
      className={`Redis-row${node.role === "master" ? " Redis-row--info" : node.problem ? " Redis-row--critical" : ""}`}
    >
      <span className="Redis-row__state">{node.role ? ROLE_LABEL[node.role] : "—"}</span>
      <span className="Redis-row__main">
        <span className="Redis-row__name">
          <b>{node.pod ? <HostLink kind="Pod" name={node.name} onClose={onClose} /> : node.name}</b>
          <NodeMeta node={node} onClose={onClose} />
        </span>
        <span className="Redis-row__reason">
          <Status
            tone={node.ready ? "ok" : "critical"}
            label={node.ready ? "Ready" : "Not ready"}
          />
          {node.upSince && (
            <span className="Redis-muted"> · up {formatAge(now - Date.parse(node.upSince))}</span>
          )}
          {node.restarts > 0 && (
            <span className="Redis-text--warning"> · {plural(node.restarts, "restart")}</span>
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
          {menuItem(
            "subject",
            "Log",
            `Opens the log of ${node.name}`,
            () => void openLog(object, node),
          )}
          {restartable &&
            menuItem(
              "restart_alt",
              "Restart",
              `Deletes ${node.name}'s pod; it comes back on its volume. Asks you to type its name`,
              () => confirmRestartNode(object, nodes, node.name, unread),
            )}
        </MenuActions>
      </span>
    </div>
  );
}

export function NodesSection({
  object,
  nodes,
  unread,
  onClose,
}: {
  object: RedisLike;
  nodes: RedisNode[];
  /** Why no write may judge these pods yet, while they are unread. */
  unread?: string;
  onClose: () => void;
}) {
  const now = Date.now();
  const restartable = kindOf(object) !== "Cluster";

  return (
    <section className="Redis-section" data-section="redis-nodes">
      <div className="Redis-section__bar">
        <h3 className="Redis-section__title">Pods</h3>
        {restartable && nodes.length > 1 && (
          <WithTooltip
            tooltip={`${kindOf(object) === "Replication" ? "Restarts the replicas one at a time, then the master" : "Restarts its pods one at a time"}. Asks you to type the name`}
          >
            <button
              type="button"
              className="Redis-button Redis-button--caution"
              onClick={() => confirmRestartAll(object, nodes, unread)}
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
            <NodeRow
              key={node.name}
              object={object}
              node={node}
              nodes={nodes}
              unread={unread}
              restartable={restartable}
              now={now}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </section>
  );
}
