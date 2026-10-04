import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { primaryOf } from "../api/members";
import { effectiveFcv, replicaSetCommands } from "../api/operations";
import { runningVersion } from "../api/replica-sets";
import type { ReplicaSetRow } from "../api/rows";
import type { EventLike } from "../api/types";
import { connectionUrl, describeTls, eventTime, replicaSetEvents, securityOf } from "../api/upkeep";
import { ago } from "../api/verdict";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import { confirmDelete, confirmScale, confirmSwitch } from "./dialogs";
import { MembersSection, openMongosh } from "./members-section";

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

interface ReplicaSetDrawerProps {
  row?: ReplicaSetRow;
  events: EventLike[];
  agentError?: string;
  onClose: () => void;
}

export const ReplicaSetDrawer = observer(
  ({ row, events, agentError, onClose }: ReplicaSetDrawerProps) => {
    const rs = row?.rs;
    const now = Date.now();
    const warnings = rs ? replicaSetEvents(events, rs) : [];

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind="Cluster"
        name={rs?.getName() ?? ""}
        onClose={onClose}
        state={row?.health}
        section="mongodb-cluster"
        actions={
          rs && row
            ? [
                {
                  icon: "terminal",
                  title: "Opens mongosh on the primary, in a terminal tab",
                  onClick: () => void openMongosh(rs, primaryOf(row.members)?.name),
                },
                {
                  icon: "swap_horiz",
                  title: "Elects another member as primary. Asks you to type the cluster's name",
                  onClick: () => confirmSwitch(rs, row.members),
                },
                {
                  icon: "unfold_more",
                  title: "Changes how many data members it has. Asks first",
                  onClick: () => confirmScale(rs),
                },
                {
                  icon: "delete",
                  title: "Deletes the cluster; its volumes are kept. Asks you to type its name",
                  onClick: () => confirmDelete(rs),
                },
              ]
            : []
        }
      >
        {rs && row && (
          <>
            <dl className="MongoDB-facts">
              <dt>Namespace</dt>
              <dd>{rs.getNs()}</dd>
              <dt>State</dt>
              <dd>
                <Status tone={row.health.tone} label={row.health.label} />
              </dd>
              <dt>Primary</dt>
              <dd>{primaryOf(row.members)?.name ?? "—"}</dd>
              <dt>Version</dt>
              <dd>
                {runningVersion(rs) ?? "—"}
                {runningVersion(rs) !== rs.spec.version && (
                  <span className="MongoDB-text--warning"> · asked for {rs.spec.version}</span>
                )}
              </dd>
              <dt>Feature compatibility</dt>
              <dd>
                {effectiveFcv(rs) ?? "—"}
                {!rs.spec.featureCompatibilityVersion && effectiveFcv(rs) && (
                  <span className="MongoDB-muted"> · follows the version</span>
                )}
              </dd>
              <dt>Members</dt>
              <dd>
                {rs.spec.members} data
                {rs.spec.arbiters
                  ? `, ${rs.spec.arbiters} arbiter${rs.spec.arbiters === 1 ? "" : "s"}`
                  : ""}
              </dd>
              {securityOf(rs).map(({ label, value }) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <dt>TLS</dt>
              <dd>{describeTls(row.tls)}</dd>
              {row.tls.ca && (
                <>
                  <dt>CA</dt>
                  <dd>{row.tls.ca}</dd>
                </>
              )}
              <dt>Connection</dt>
              <dd>
                {connectionUrl(rs) ? (
                  <span className="MongoDB-copyable">
                    <code className="MongoDB-mono">{connectionUrl(rs)}</code>
                    <WithTooltip tooltip="Copies the URL, without the password; the command for the full one is under Look further">
                      <button
                        type="button"
                        className="MongoDB-button"
                        onClick={() => void copy("Connection URL", connectionUrl(rs) ?? "")}
                      >
                        Copy
                      </button>
                    </WithTooltip>
                  </span>
                ) : (
                  "—"
                )}
              </dd>
              <dt>Created</dt>
              <dd>{rs.metadata.creationTimestamp ?? "—"}</dd>
            </dl>

            <MembersSection rs={rs} members={row.members} agentError={agentError} />

            <section className="MongoDB-section" data-section="mongodb-users">
              <h3 className="MongoDB-section__title">Users</h3>
              {row.users.length === 0 ? (
                <p className="MongoDB-section__note">It declares no users.</p>
              ) : (
                <div className="MongoDB-list">
                  {row.users.map(({ user, hasPassword, connectionSecret }) => (
                    <div
                      key={`${user.db}/${user.name}`}
                      className={`MongoDB-row${hasPassword ? "" : " MongoDB-row--critical"}`}
                    >
                      <span className="MongoDB-row__main">
                        <span className="MongoDB-row__name">
                          <b>{user.name}</b>
                          <span className="MongoDB-row__meta">{user.db}</span>
                        </span>
                        <span className="MongoDB-row__reason">
                          {(user.roles ?? []).map((role) => `${role.name}@${role.db}`).join(", ") ||
                            "No roles"}
                          {hasPassword ? (
                            <span className="MongoDB-muted">
                              {" "}
                              · connection in {connectionSecret}
                            </span>
                          ) : (
                            <span className="MongoDB-text--critical">
                              {" "}
                              · its password Secret {user.passwordSecretRef?.name} does not exist
                            </span>
                          )}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="MongoDB-section" data-section="mongodb-warnings">
              <h3 className="MongoDB-section__title">Recent warnings</h3>
              {warnings.length === 0 ? (
                <p className="MongoDB-section__note">
                  No warning events for the cluster, its pods or its volumes.
                </p>
              ) : (
                <div className="MongoDB-list">
                  {warnings.slice(0, SHOWN_WARNINGS).map((event) => (
                    <div key={event.getName()} className="MongoDB-row MongoDB-row--warning">
                      <span className="MongoDB-row__main">
                        <span className="MongoDB-row__name">
                          <b>{event.reason ?? "Warning"}</b>
                          <span className="MongoDB-row__meta">
                            {event.involvedObject.kind} {event.involvedObject.name}
                            {(event.count ?? 1) > 1 && ` · ${event.count} times`}
                          </span>
                        </span>
                        <span className="MongoDB-row__reason">{event.message}</span>
                      </span>
                      <span className="MongoDB-row__aside">{ago(eventTime(event), now)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="MongoDB-section" data-section="mongodb-commands">
              <h3 className="MongoDB-section__title">Look further</h3>
              <div className="MongoDB-list">
                {replicaSetCommands(rs).map(({ label, command }) => (
                  <div key={label} className="MongoDB-row">
                    <span className="MongoDB-row__main">
                      <span className="MongoDB-row__name">{label}</span>
                      <code className="MongoDB-row__reason">{command}</code>
                    </span>
                    <span className="MongoDB-row__actions">
                      <WithTooltip tooltip="Copies the command, to paste into a terminal">
                        <button
                          type="button"
                          className="MongoDB-button"
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
  },
);
