import { Renderer } from "@freelensapp/extensions";
import type { ReplicationRole } from "../api/clusters/agent";
import { type Member, preferredOf } from "../api/clusters/members";
import type { ReplicaSetLike } from "../api/shared/types";
import { formatAge, plural } from "../api/shared/verdict";
import { openMemberLog, openTerminal } from "../api/writes/actions";
import { type Connection, mongoshCommand, offersSwitch } from "../api/writes/operations";
import { HostLink } from "../components/drawer-link";
import { Status } from "../components/status";
import { confirmRestartAll, confirmRestartMember, confirmSwitch } from "./dialogs";

const {
  Component: { Icon, MenuActions, MenuItem, Notifications, WithTooltip },
} = Renderer;

const ROLE_LABEL: Record<ReplicationRole, string> = {
  primary: "Primary",
  secondary: "Secondary",
  arbiter: "Arbiter",
  starting: "Starting",
  recovering: "Recovering",
  down: "Down",
  "not running": "Not running",
  unknown: "Unknown",
};

export async function openMongosh(
  rs: ReplicaSetLike,
  member: string | undefined,
  connection: Connection | undefined,
) {
  if (!member) {
    Notifications.error(`${rs.getName()} has no ready member to connect to.`);
    return;
  }

  try {
    await openTerminal(`mongosh ${member}`, mongoshCommand(rs, member, connection));
  } catch (error) {
    Notifications.checkedError(error, `Could not open a terminal on ${member}`);
  }
}

async function openLog(rs: ReplicaSetLike, member: string, container: "mongod" | "mongodb-agent") {
  try {
    if (!(await openMemberLog(rs, member, container))) {
      Notifications.error(`${member} has no running ${container} container.`);
    }
  } catch (error) {
    Notifications.checkedError(error, `Could not open the log of ${member}`);
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

function MemberRow({
  rs,
  member,
  members,
  preferred,
  connection,
  now,
  onClose,
}: {
  rs: ReplicaSetLike;
  member: Member;
  members: Member[];
  preferred: Member | undefined;
  connection: Connection | undefined;
  now: number;
  onClose: () => void;
}) {
  return (
    <div
      className={`MongoDB-row${member.role === "primary" ? " MongoDB-row--info" : member.problem ? " MongoDB-row--critical" : ""}`}
    >
      <span className="MongoDB-row__state">
        {member.role ? ROLE_LABEL[member.role] : member.arbiter ? "Arbiter" : "—"}
      </span>
      <span className="MongoDB-row__main">
        <span className="MongoDB-row__name">
          <b>
            {member.pod ? (
              <HostLink kind="Pod" name={member.name} onClose={onClose} />
            ) : (
              member.name
            )}
          </b>
          <span className="MongoDB-row__meta">
            {[
              member.node && (
                <HostLink key="node" kind="Node" name={member.node} onClose={onClose} />
              ),
              member.pvc && (
                <HostLink
                  key="volume"
                  kind="PersistentVolumeClaim"
                  name={member.pvc}
                  label={member.volume ?? member.pvc}
                  onClose={onClose}
                />
              ),
              member === preferred ? "preferred primary" : undefined,
              member.extra ? "left from a scale-down" : undefined,
            ]
              .filter(Boolean)
              .flatMap((each, at) => (at === 0 ? [each] : [" · ", each]))}
          </span>
        </span>
        <span className="MongoDB-row__reason">
          <Status
            tone={member.ready ? "ok" : "critical"}
            label={member.ready ? "Ready" : "Not ready"}
          />
          {member.upSince && (
            <span className="MongoDB-muted">
              {" "}
              · up {formatAge(now - Date.parse(member.upSince))}
            </span>
          )}
          {member.restarts > 0 && (
            <span className="MongoDB-text--warning"> · {plural(member.restarts, "restart")}</span>
          )}
          {member.problem && <span className="MongoDB-text--critical"> · {member.problem}</span>}
          {member.applying && (
            <span className="MongoDB-muted"> · applying a change: {member.applying}</span>
          )}
        </span>
      </span>
      <span className="MongoDB-row__actions">
        <WithTooltip tooltip={`Opens mongosh on ${member.name}, in a terminal tab`}>
          <button
            type="button"
            className="MongoDB-button"
            disabled={!member.ready}
            onClick={() => void openMongosh(rs, member.name, connection)}
          >
            mongosh
          </button>
        </WithTooltip>
        <MenuActions toolbar={false} autoCloseOnSelect>
          {menuItem(
            "subject",
            "mongod log",
            `Opens the log of ${member.name}'s mongod container`,
            () => void openLog(rs, member.name, "mongod"),
          )}
          {menuItem(
            "manage_history",
            "Agent log",
            `Opens the log of ${member.name}'s automation agent`,
            () => void openLog(rs, member.name, "mongodb-agent"),
          )}
          {offersSwitch(rs, member) &&
            menuItem(
              "swap_horiz",
              "Make primary",
              `Elects ${member.name} as primary. Asks you to type the cluster's name`,
              () => confirmSwitch(rs, members, member.name),
            )}
          {menuItem(
            "restart_alt",
            "Restart",
            `Deletes ${member.name}'s pod; it comes back on its volume. Asks you to type its name`,
            () => confirmRestartMember(rs, members, member.name),
          )}
        </MenuActions>
      </span>
    </div>
  );
}

export function MembersSection({
  rs,
  members,
  connection,
  agentError,
  onClose,
}: {
  rs: ReplicaSetLike;
  members: Member[];
  connection: Connection | undefined;
  agentError?: string;
  onClose: () => void;
}) {
  const now = Date.now();
  const preferred = preferredOf(members);

  return (
    <section className="MongoDB-section" data-section="mongodb-members">
      <div className="MongoDB-section__bar">
        <h3 className="MongoDB-section__title">Members</h3>
        {members.length > 1 && (
          <WithTooltip tooltip="Restarts the secondaries and arbiters one at a time, then the primary, which hands over as it stops. Asks you to type the cluster's name">
            <button
              type="button"
              className="MongoDB-button MongoDB-button--caution"
              onClick={() => confirmRestartAll(rs, members)}
            >
              Restart all
            </button>
          </WithTooltip>
        )}
      </div>
      {agentError && (
        <p className="MongoDB-hint">
          Roles and causes come from each member's agent, which could not be read: {agentError}.
        </p>
      )}
      {members.length === 0 ? (
        <p className="MongoDB-section__note">None yet.</p>
      ) : (
        <div className="MongoDB-list">
          {members.map((member) => (
            <MemberRow
              key={member.name}
              rs={rs}
              member={member}
              members={members}
              preferred={preferred}
              connection={connection}
              now={now}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </section>
  );
}
