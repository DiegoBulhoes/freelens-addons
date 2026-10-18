import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import { type Member, primaryOf } from "../api/clusters/members";
import type { ReplicaSetLike } from "../api/shared/types";
import { plural } from "../api/shared/verdict";
import {
  deleteReplicaSet,
  patchReplicaSet,
  restartMember,
  runRestartAll,
  switchPrimary,
} from "../api/writes/actions";
import {
  describeStep,
  memberRestartRefusal,
  restartAllPlan,
  restartingRefusal,
  scaleAdvice,
  scalePatch,
  switchTarget,
} from "../api/writes/operations";
import { confirmWrite, notifyDone } from "../components/confirm";

const {
  Component: { Input, Notifications },
} = Renderer;

function notifyFailure(error: unknown, what: string) {
  Notifications.checkedError(error, `Could not ${what}`);
}

function notifyRefusal(reason: string | undefined): boolean {
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

/** The count, with why it is refused or what to know about it, said as it is typed. */
function ScaleField({
  initial,
  advise,
  onType,
}: {
  initial: string;
  advise: (text: string) => { refused?: string; warnings: string[] };
  onType: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const advice = advise(value);

  return (
    <div className="MongoDB-form__field">
      <span>Data members</span>
      <Input
        aria-label="Data members"
        value={value}
        onChange={(next: string) => {
          setValue(next);
          onType(next);
        }}
      />
      {value === initial ? null : advice.refused ? (
        <span className="MongoDB-text--critical">{advice.refused}</span>
      ) : (
        advice.warnings.map((warning) => (
          <span key={warning} className="MongoDB-text--warning">
            {warning}
          </span>
        ))
      )}
    </div>
  );
}

export function confirmScale(rs: ReplicaSetLike): void {
  const name = rs.getName();
  let typed = String(rs.spec.members);

  if (notifyRefusal(restartingRefusal(rs))) return;

  confirmWrite({
    question: (
      <>
        Change how many data members <b>{name}</b> has?
      </>
    ),
    detail: `It has ${rs.spec.members}${rs.spec.arbiters ? ` and ${plural(rs.spec.arbiters, "arbiter")}` : ""}. The operator adds or removes them one at a time.`,
    form: (
      <ScaleField
        initial={typed}
        advise={(text) => scaleAdvice(rs, text)}
        onType={(text) => {
          typed = text;
        }}
      />
    ),
    label: "Scale",
    destructive: false,
    ok: async () => {
      const { count, refused } = scaleAdvice(rs, typed);

      if (notifyRefusal(refused)) return;

      try {
        await patchReplicaSet(rs, scalePatch(rs, count));
        notifyDone(`${name} scaled to ${plural(count, "member")}.`, {
          run: () => patchReplicaSet(rs, scalePatch(rs, rs.spec.members)),
        });
      } catch (error) {
        notifyFailure(error, `scale ${name}`);
      }
    },
  });
}

export function confirmSwitch(rs: ReplicaSetLike, members: Member[], to?: string): void {
  const name = rs.getName();
  const chosen = switchTarget(rs, members, to);

  if ("refused" in chosen) {
    Notifications.error(chosen.refused);
    return;
  }

  const { candidates } = chosen;
  let target = chosen.target;

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
      if (notifyRefusal(restartingRefusal(rs))) return;

      try {
        await switchPrimary(rs, target);
        notifyDone(`${target} will be elected primary of ${name}.`);
      } catch (error) {
        notifyFailure(error, `switch the primary of ${name}`);
      }
    },
  });
}

export function confirmRestartMember(rs: ReplicaSetLike, members: Member[], member: string): void {
  if (notifyRefusal(memberRestartRefusal(rs, members, member))) return;

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
      if (notifyRefusal(restartingRefusal(rs))) return;

      try {
        await restartMember(rs, member);
        notifyDone(`Restart of ${member} requested.`);
      } catch (error) {
        notifyFailure(error, `restart ${member}`);
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
    label: `Restart ${plan.steps.length}`,
    destructive: true,
    typed: () => name,
    ok: async () => {
      if (notifyRefusal(restartingRefusal(rs))) return;

      Notifications.info(`Restarting ${name}, one member at a time.`);

      try {
        await runRestartAll(rs, plan.steps, (done) => Notifications.ok(`${name}: ${done}, done.`));
        notifyDone(`Every member of ${name} was restarted.`);
      } catch (error) {
        notifyFailure(error, `restart every member of ${name}`);
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
        notifyFailure(error, `delete ${name}`);
      }
    },
  });
}
