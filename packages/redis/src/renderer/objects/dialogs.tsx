import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import { kindOf, masterOf, type RedisNode, sizeOf } from "../api/objects/nodes";
import type { RedisLike } from "../api/shared/types";
import { failover, patchObject, restartNode, runRestartAll } from "../api/writes/actions";
import {
  describeRestartStart,
  describeStep,
  describeStepDone,
  failoverRefusal,
  nodeRestartRefusal,
  type RestartStep,
  restartAllPlan,
  restartAllRefusal,
  scaleAdvice,
  scalePatch,
  scaleRefusal,
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
    <div className="Redis-form__field">
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

/** Reports through a callback, and says what the typed size would do before it is sent. */
function ScaleField({
  label,
  initial,
  notesFor,
  onType,
}: {
  label: string;
  initial: string;
  notesFor: (text: string) => { refused?: string; warnings: string[] };
  onType: (text: string) => void;
}) {
  const [notes, setNotes] = useState(() => notesFor(initial));

  return (
    <>
      <Field
        label={label}
        initial={initial}
        onType={(text) => {
          setNotes(notesFor(text));
          onType(text);
        }}
      />
      {notes.refused && <span className="Redis-text--critical">{notes.refused}</span>}
      {notes.warnings.map((warning) => (
        <span key={warning} className="Redis-text--warning">
          {warning}
        </span>
      ))}
    </>
  );
}

const SIZE_LABEL = {
  Replication: "Pods",
  Cluster: "Leaders (and as many followers)",
  Sentinel: "Sentinels",
  Standalone: "Pods",
};

export function confirmScale(object: RedisLike): void {
  const name = object.getName();
  const kind = kindOf(object);

  if (notifyRefusal(kind === "Standalone" ? scaleRefusal(object, 1) : undefined)) return;

  let typed = String(sizeOf(object));

  confirmWrite({
    question: (
      <>
        Change the size of <b>{name}</b>?
      </>
    ),
    detail: `It has ${sizeOf(object)}. The operator adds or removes pods to match.`,
    form: (
      <ScaleField
        label={SIZE_LABEL[kind]}
        initial={typed}
        notesFor={(text) => scaleAdvice(object, text)}
        onType={(text) => {
          typed = text;
        }}
      />
    ),
    label: "Scale",
    destructive: false,
    ok: async () => {
      const count = Number(typed.trim());

      if (notifyRefusal(scaleRefusal(object, count))) return;

      try {
        await patchObject(object, scalePatch(object, count));
        notifyDone(`${name} scaled to ${count}.`, {
          run: () => patchObject(object, scalePatch(object, sizeOf(object))),
        });
      } catch (error) {
        notifyFailure(error, `scale ${name}`);
      }
    },
  });
}

const RESTART_DETAIL = {
  master:
    "It is the master: a sentinel, if one watches it, promotes a replica; writes pause until then.",
  replica: "Deletes its pod; it comes back on the same volume and catches up with the master.",
  sentinel: "Deletes its pod; the other sentinels keep watching until it is back.",
  standalone:
    "Deletes its pod; it comes back on the same volume. Clients cannot connect until then.",
};

export function confirmRestartNode(
  object: RedisLike,
  nodes: RedisNode[],
  node: string,
  unread?: string,
): void {
  if (notifyRefusal(unread ?? nodeRestartRefusal(object, nodes, node))) return;

  const role = nodes.find((each) => each.name === node)?.role;

  confirmWrite({
    question: (
      <>
        Restart <b>{node}</b>?
      </>
    ),
    detail: RESTART_DETAIL[role ?? "standalone"],
    label: "Restart",
    destructive: true,
    typed: () => node,
    ok: async () => {
      try {
        await restartNode(object, node, role);
        notifyDone(`Restart of ${node} requested.`);
      } catch (error) {
        notifyFailure(error, `restart ${node}`);
      }
    },
  });
}

/** Says when it starts and as each pod is done; a failure is the caller's to report. */
export async function restartWithProgress(object: RedisLike, steps: RestartStep[]): Promise<void> {
  const name = object.getName();
  let at = 0;

  Notifications.info(describeRestartStart(name, steps));
  await runRestartAll(object, steps, (step) => {
    at += 1;
    Notifications.ok(describeStepDone(name, step, at, steps.length));
  });
}

export function confirmRestartAll(object: RedisLike, nodes: RedisNode[], unread?: string): void {
  const name = object.getName();
  const plan = restartAllPlan(object, nodes);
  const refused = unread ?? restartAllRefusal(plan);

  if (refused) {
    Notifications.error(`${name} cannot be restarted pod by pod: ${refused}`);
    return;
  }
  if (!("steps" in plan)) return;

  confirmWrite({
    question: (
      <>
        Restart every pod of <b>{name}</b>?
      </>
    ),
    detail: `In order: ${plan.steps.map(describeStep).join(", then ")}.${
      kindOf(object) === "Replication" ? " The replicas go first and the master last." : ""
    } Each waits for the set to settle, and stops if anything changed. Keep Freelens open until it ends.`,
    label: `Restart ${plan.steps.length}`,
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await restartWithProgress(object, plan.steps);
        notifyDone(`Every pod of ${name} was restarted.`);
      } catch (error) {
        notifyFailure(error, `restart every pod of ${name}`);
      }
    },
  });
}

export function confirmFailover(
  replication: RedisLike,
  nodes: RedisNode[],
  sentinel: RedisLike | undefined,
  sentinelNodes: RedisNode[],
  unread?: string,
): void {
  if (notifyRefusal(unread ?? failoverRefusal(replication, nodes, sentinel, sentinelNodes))) return;

  const name = replication.getName();

  confirmWrite({
    question: (
      <>
        Fail <b>{name}</b> over to a replica?
      </>
    ),
    detail: `${masterOf(nodes)?.name ?? "The master"} steps down and ${sentinel?.getName() ?? "its sentinels"} promote a replica, as SENTINEL FAILOVER does. Writes pause for a few seconds. The pods' roles show the change about half a minute later.`,
    label: "Fail over",
    destructive: true,
    typed: () => name,
    ok: async () => {
      if (!sentinel) return;

      try {
        await failover(sentinel, sentinelNodes);
        notifyDone(`Failover of ${name} started; its new master shows within a minute.`);
      } catch (error) {
        notifyFailure(error, `fail ${name} over`);
      }
    },
  });
}
