import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import { deleteMemberPod, deleteReplicaSet, patchReplicaSet, runRestartAll } from "../api/actions";
import { dataMembers, type Member, primaryOf } from "../api/members";
import {
  describeStep,
  memberRestartRefusal,
  restartAllPlan,
  rollingRestartPatch,
  rollingRestartRefusal,
  scalePatch,
  scaleRefusal,
  scaleWarnings,
  switchPatch,
  switchRefusal,
} from "../api/operations";
import type { ReplicaSetLike } from "../api/types";
import { confirmWrite, notifyDone } from "../components/confirm";

const {
  Component: { Input, Notifications },
} = Renderer;

function failed(error: unknown, what: string) {
  Notifications.checkedError(error, `Could not ${what}`);
}

function stop(reason: string | undefined): boolean {
  if (reason) Notifications.error(reason);

  return Boolean(reason);
}

function Choice({
  label,
  options,
  initial,
  titleOf,
  onPick,
}: {
  label: string;
  options: string[];
  initial?: string;
  titleOf: (option: string) => string;
  onPick: (option: string) => void;
}) {
  const [picked, setPicked] = useState(initial ?? options[0]);

  return (
    <div className="MongoDB-form__field">
      <span>{label}</span>
      <div className="MongoDB-filters">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="MongoDB-filter"
            aria-pressed={picked === option}
            title={titleOf(option)}
            onClick={() => {
              setPicked(option);
              onPick(option);
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  initial,
  onType,
}: {
  label: string;
  initial: string;
  onType: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <div className="MongoDB-form__field">
      <span>{label}</span>
      <Input
        aria-label={label}
        value={value}
        onChange={(next: string) => {
          setValue(next);
          onType(next);
        }}
      />
    </div>
  );
}

export function confirmScale(rs: ReplicaSetLike): void {
  const name = rs.getName();
  let typed = String(rs.spec.members);

  confirmWrite({
    question: (
      <>
        Change how many data members <b>{name}</b> has?
      </>
    ),
    detail: `It has ${rs.spec.members}${rs.spec.arbiters ? ` and ${rs.spec.arbiters} arbiter${rs.spec.arbiters === 1 ? "" : "s"}` : ""}. The operator adds or removes them one at a time.`,
    form: (
      <Field
        label="Data members"
        initial={typed}
        onType={(text) => {
          typed = text;
        }}
      />
    ),
    label: "Scale",
    destructive: false,
    ok: async () => {
      const count = Number(typed.trim());

      if (stop(scaleRefusal(rs, count))) return;

      const warnings = scaleWarnings(rs, count);

      try {
        await patchReplicaSet(rs, scalePatch(rs, count));
        notifyDone(
          `${name} scaled to ${count} member${count === 1 ? "" : "s"}.${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}`,
          { run: () => patchReplicaSet(rs, scalePatch(rs, rs.spec.members)) },
        );
      } catch (error) {
        failed(error, `scale ${name}`);
      }
    },
  });
}

export function confirmSwitch(rs: ReplicaSetLike, members: Member[], to?: string): void {
  const name = rs.getName();
  const candidates = dataMembers(members)
    .filter((each) => !switchRefusal(rs, members, each.name))
    .map((each) => each.name);
  let target = to ?? candidates[0] ?? "";

  if (stop(switchRefusal(rs, members, target))) return;

  confirmWrite({
    question: (
      <>
        Make another member the primary of <b>{name}</b>?
      </>
    ),
    detail: `${primaryOf(members)?.name ?? "The primary"} steps down and the chosen member is elected. Writes pause for a few seconds. The chosen member keeps the higher priority, so it is preferred from now on.`,
    form:
      candidates.length > 1 && !to ? (
        <Choice
          label="New primary"
          options={candidates}
          titleOf={(option) => `Makes ${option} the primary`}
          onPick={(option) => {
            target = option;
          }}
        />
      ) : undefined,
    label: "Switch",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await patchReplicaSet(rs, switchPatch(rs, members, target));
        notifyDone(`${target} will be elected primary of ${name}.`);
      } catch (error) {
        failed(error, `switch the primary of ${name}`);
      }
    },
  });
}

export function confirmRestartMember(rs: ReplicaSetLike, members: Member[], member: string): void {
  if (stop(memberRestartRefusal(members, member))) return;

  const primary = primaryOf(members)?.name === member;

  confirmWrite({
    question: (
      <>
        Restart <b>{member}</b>?
      </>
    ),
    detail: primary
      ? "It is the primary: the others elect a new one while it restarts, and writes pause for a few seconds."
      : "Deletes its pod; it comes back on the same volume and catches up.",
    label: "Restart",
    destructive: true,
    typed: () => member,
    ok: async () => {
      try {
        await deleteMemberPod(rs, member);
        notifyDone(`Restart of ${member} requested.`);
      } catch (error) {
        failed(error, `restart ${member}`);
      }
    },
  });
}

export function confirmRestartAll(rs: ReplicaSetLike, members: Member[]): void {
  const name = rs.getName();
  const plan = restartAllPlan(rs, members);

  if ("refused" in plan) {
    Notifications.error(`${name} cannot be restarted member by member: ${plan.refused}`);
    return;
  }

  confirmWrite({
    question: (
      <>
        Restart every member of <b>{name}</b>?
      </>
    ),
    detail: `In order: ${plan.steps.map(describeStep).join(", then ")}. The primary steps down as it stops and a secondary takes over at once; a preferred member takes the primary back when it returns. Each waits for the set to settle, and stops if anything changed. Keep Freelens open until it ends.`,
    label: `Restart ${members.filter((each) => !each.extra).length}`,
    destructive: true,
    typed: () => name,
    ok: async () => {
      Notifications.info(`Restarting ${name}, one member at a time.`);

      try {
        await runRestartAll(rs, plan.steps, (done) => Notifications.ok(`${name}: ${done}, done.`));
        notifyDone(`Every member of ${name} was restarted.`);
      } catch (error) {
        failed(error, `restart every member of ${name}`);
      }
    },
  });
}

export function confirmRollingRestart(rs: ReplicaSetLike): void {
  if (stop(rollingRestartRefusal(rs))) return;

  const name = rs.getName();

  confirmWrite({
    question: (
      <>
        Ask the operator to restart <b>{name}</b>?
      </>
    ),
    detail:
      "Its StatefulSet restarts the members by index, highest first, whichever is primary. Restart all, in the drawer, keeps the primary for last.",
    label: "Restart",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await patchReplicaSet(rs, rollingRestartPatch(Date.now()));
        notifyDone(`Rolling restart of ${name} requested.`);
      } catch (error) {
        failed(error, `restart ${name}`);
      }
    },
  });
}

export function confirmDelete(rs: ReplicaSetLike): void {
  const name = rs.getName();

  confirmWrite({
    question: (
      <>
        Delete <b>{name}</b>?
      </>
    ),
    detail:
      "The operator removes its StatefulSets and pods. Its volumes are kept until deleted by hand.",
    label: "Delete",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await deleteReplicaSet(rs);
        notifyDone(`Deleted ${name}.`);
      } catch (error) {
        failed(error, `delete ${name}`);
      }
    },
  });
}
