import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { primaryLabel } from "../api/clusters/members";
import { isChangingVersion, runningVersion } from "../api/clusters/replica-sets";
import type { ReplicaSetRow } from "../api/clusters/rows";
import {
  connectionOf,
  connectionUrl,
  describeTls,
  eventTime,
  replicaSetEvents,
  securityOf,
  type UserView,
  warningsNote,
} from "../api/clusters/upkeep";
import type { EventLike } from "../api/shared/types";
import { ago, plural } from "../api/shared/verdict";
import { effectiveFcv, mongoshTarget, replicaSetCommands } from "../api/writes/operations";
import { CommandsSection, copyText } from "../components/commands-section";
import { HostLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import { useWarningEvents } from "../hooks/use-warning-events";
import { confirmDelete, confirmScale, confirmSwitch } from "./dialogs";
import { MembersSection, openMongosh } from "./members-section";

const {
  Component: { WithTooltip },
} = Renderer;

const SHOWN_WARNINGS = 8;

function SecretName({
  name,
  missing,
  onClose,
}: {
  name: string;
  missing: string[];
  onClose: () => void;
}) {
  return missing.includes(name) ? (
    <span className="MongoDB-text--critical">{name} does not exist</span>
  ) : (
    <HostLink kind="Secret" name={name} onClose={onClose} />
  );
}

function UsersSection({ users, onClose }: { users: UserView[]; onClose: () => void }) {
  return (
    <section className="MongoDB-section" data-section="mongodb-users">
      <h3 className="MongoDB-section__title">Users</h3>
      {users.length === 0 ? (
        <p className="MongoDB-section__note">It declares no users.</p>
      ) : (
        <div className="MongoDB-list">
          {users.map(({ user, hasPassword, connectionSecret, connectionExists }) => (
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
                  {hasPassword && connectionExists === false ? (
                    <span className="MongoDB-text--warning">
                      {" "}
                      · its connection Secret {connectionSecret} does not exist yet
                    </span>
                  ) : hasPassword ? (
                    <span className="MongoDB-muted">
                      {" "}
                      · connection in{" "}
                      <HostLink kind="Secret" name={connectionSecret} onClose={onClose} />
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
  );
}

function WarningsSection({
  warnings,
  note,
  now,
}: {
  warnings: EventLike[];
  note: string | undefined;
  now: number;
}) {
  return (
    <section className="MongoDB-section" data-section="mongodb-warnings">
      <h3 className="MongoDB-section__title">Recent warnings</h3>
      {note && <p className="MongoDB-section__note">{note}</p>}
      {warnings.length > 0 && (
        <div className="MongoDB-list">
          {warnings.slice(0, SHOWN_WARNINGS).map((event) => (
            <div
              key={event.metadata.uid ?? event.metadata.name}
              className="MongoDB-row MongoDB-row--warning"
            >
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
  );
}

interface ReplicaSetDrawerProps {
  row?: ReplicaSetRow;
  agentError?: string;
  onClose: () => void;
}

export const ReplicaSetDrawer = observer(({ row, agentError, onClose }: ReplicaSetDrawerProps) => {
  const rs = row?.rs;
  const now = Date.now();
  const read = useWarningEvents(rs?.getNs());
  const warnings = rs && read && "events" in read ? replicaSetEvents(read.events, rs) : [];
  const note = warningsNote(read, warnings.length);
  const connection = row ? connectionOf(row.users) : undefined;
  const url = rs ? connectionUrl(rs) : undefined;
  const version = rs ? runningVersion(rs) : undefined;
  const fcv = rs ? effectiveFcv(rs) : undefined;

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
                title:
                  "Opens mongosh on the primary, or on a ready member while none is known, in a terminal tab",
                onClick: () => void openMongosh(rs, mongoshTarget(row.members), connection),
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
            <dd>{primaryLabel(row.members)}</dd>
            <dt>Version</dt>
            <dd>
              {version ?? "—"}
              {isChangingVersion(rs) && (
                <span className="MongoDB-text--warning"> · asked for {rs.spec.version}</span>
              )}
              {!version && (
                <span className="MongoDB-muted"> · {rs.spec.version} not reached yet</span>
              )}
            </dd>
            <dt>Feature compatibility</dt>
            <dd>
              {fcv ?? "—"}
              {!rs.spec.featureCompatibilityVersion && fcv && (
                <span className="MongoDB-muted"> · follows the version</span>
              )}
            </dd>
            <dt>Members</dt>
            <dd>
              {rs.spec.members} data
              {rs.spec.arbiters ? `, ${plural(rs.spec.arbiters, "arbiter")}` : ""}
            </dd>
            {securityOf(rs).map(({ label, value }) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <dt>TLS</dt>
            <dd>{describeTls(row.tls)}</dd>
            {row.tls.secret && (
              <>
                <dt>TLS Secret</dt>
                <dd>
                  <SecretName name={row.tls.secret} missing={row.tls.missing} onClose={onClose} />
                </dd>
              </>
            )}
            {row.tls.ca && (
              <>
                <dt>CA</dt>
                <dd>
                  {row.tls.caSecret ? (
                    <>
                      Secret{" "}
                      <SecretName
                        name={row.tls.caSecret}
                        missing={row.tls.missing}
                        onClose={onClose}
                      />
                    </>
                  ) : (
                    row.tls.ca
                  )}
                </dd>
              </>
            )}
            <dt>Connection</dt>
            <dd>
              {url ? (
                <span className="MongoDB-copyable">
                  <code className="MongoDB-mono">{url}</code>
                  <WithTooltip tooltip="Copies the URL, without the password; the command for the full one is under Look further">
                    <button
                      type="button"
                      className="MongoDB-button"
                      onClick={() => void copyText("Connection URL", url)}
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

          <MembersSection
            rs={rs}
            members={row.members}
            connection={connection}
            agentError={agentError}
            onClose={onClose}
          />

          <UsersSection users={row.users} onClose={onClose} />

          <WarningsSection warnings={warnings} note={note} now={now} />

          <CommandsSection
            commands={replicaSetCommands(rs, connection)}
            section="mongodb-commands"
          />
        </>
      )}
    </ObjectDrawer>
  );
});
