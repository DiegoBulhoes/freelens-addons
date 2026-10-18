import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { cliTarget, kindOf, masterOf, type RedisNode } from "../api/objects/nodes";
import { type RedisRow, unreadRefusal } from "../api/objects/rows";
import {
  connectionUrls,
  describeTlsIssuer,
  eventsOf,
  eventTime,
  passwordSecretOf,
  warningsNote,
} from "../api/objects/upkeep";
import type { OpenPage } from "../api/shared/navigation";
import type { RedisLike } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { commandsOf } from "../api/writes/operations";
import { CommandsSection, copyText } from "../components/commands-section";
import { DrawerLink, HostLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import { useWarningEvents } from "../hooks/use-warning-events";
import { confirmFailover, confirmScale } from "./dialogs";
import { NodesSection, openRedisCli } from "./nodes-section";

const {
  Component: { WithTooltip },
} = Renderer;

const SHOWN_WARNINGS = 8;

interface RedisDrawerProps {
  row?: RedisRow;
  /** Every row, to find the pods of a replication's sentinel. */
  rows: RedisRow[];
  open: OpenPage;
  onClose: () => void;
}

function drawerActions(
  row: RedisRow,
  sentinelRow: RedisRow | undefined,
  cliNode: RedisNode | undefined,
) {
  const { object } = row;

  return [
    {
      icon: "terminal",
      title: `Opens redis-cli on ${cliNode?.name ?? "a pod"}, in a terminal tab`,
      onClick: () => void openRedisCli(object, cliNode),
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
                unreadRefusal(row) ?? (sentinelRow && unreadRefusal(sentinelRow)),
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
  ];
}

function RedisFacts({
  row,
  onClose,
  open,
}: {
  row: RedisRow;
  onClose: () => void;
  open: OpenPage;
}) {
  const { object } = row;
  const master = masterOf(row.nodes);
  const password = passwordSecretOf(object)?.name;
  const watched = row.kind === "Sentinel" ? row.related[0] : undefined;
  const objectLink = (each: RedisLike) => (
    <DrawerLink
      title={`Opens ${each.getName()}'s drawer`}
      onClick={() => {
        onClose();
        open(kindOf(each), { namespace: each.getNs(), name: each.getName() });
      }}
    >
      {each.getName()}
    </DrawerLink>
  );

  return (
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
          <dd>{master ? <HostLink kind="Pod" name={master.name} onClose={onClose} /> : "—"}</dd>
          <dt>Sentinels</dt>
          <dd>
            {row.related.length > 0
              ? row.related.map((each) => <div key={each.getName()}>{objectLink(each)}</div>)
              : "None: nothing fails it over"}
          </dd>
        </>
      )}
      {row.kind === "Sentinel" && (
        <>
          <dt>Watches</dt>
          <dd>
            {watched
              ? objectLink(watched)
              : (object.spec.redisSentinelConfig?.redisReplicationName ?? "—")}
          </dd>
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
        {password ? (
          <>
            From Secret <HostLink kind="Secret" name={password} onClose={onClose} />
          </>
        ) : (
          "None"
        )}
      </dd>
      <dt>TLS</dt>
      <dd>
        {row.tls.enabled && row.tls.secret ? (
          <>
            On · Secret <HostLink kind="Secret" name={row.tls.secret} onClose={onClose} />
            {describeTlsIssuer(row.tls)}
          </>
        ) : (
          "Off"
        )}
      </dd>
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
                  onClick={() => void copyText(`${label} URL`, url)}
                >
                  Copy
                </button>
              </WithTooltip>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export const RedisDrawer = observer(({ row, rows, open, onClose }: RedisDrawerProps) => {
  const object = row?.object;
  const now = Date.now();
  const read = useWarningEvents(object?.getNs());
  const warnings = object && read && "events" in read ? eventsOf(read.events, object) : [];
  const note = warningsNote(read, warnings.length);
  const sentinelRow =
    row?.kind === "Replication"
      ? rows.find((each) => row.related.includes(each.object))
      : undefined;
  const cliNode: RedisNode | undefined = row ? cliTarget(row.nodes) : undefined;

  return (
    <ObjectDrawer
      open={Boolean(row)}
      kind={row?.kind ?? "Redis"}
      name={object?.getName() ?? ""}
      onClose={onClose}
      state={row?.health}
      section="redis-object"
      actions={object && row ? drawerActions(row, sentinelRow, cliNode) : []}
    >
      {object && row && (
        <>
          <RedisFacts row={row} onClose={onClose} open={open} />

          <NodesSection
            object={object}
            nodes={row.nodes}
            unread={unreadRefusal(row)}
            onClose={onClose}
          />

          <section className="Redis-section" data-section="redis-warnings">
            <h3 className="Redis-section__title">Recent warnings</h3>
            {note ? (
              <p className="Redis-section__note">{note}</p>
            ) : (
              <div className="Redis-list">
                {warnings.slice(0, SHOWN_WARNINGS).map((event) => (
                  <div key={event.metadata.name} className="Redis-row Redis-row--warning">
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

          <CommandsSection commands={commandsOf(object)} section="redis-commands" />
        </>
      )}
    </ObjectDrawer>
  );
});
