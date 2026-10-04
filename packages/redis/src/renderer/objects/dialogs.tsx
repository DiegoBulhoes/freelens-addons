import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import { deletePod, failover, patchObject, runRestartAll } from "../api/actions";
import { kindOf, masterOf, type RedisNode } from "../api/nodes";
import {
  describeStep,
  failoverRefusal,
  memberRestartRefusal,
  restartAllPlan,
  scalePatch,
  scaleRefusal,
  scaleWarnings,
} from "../api/operations";
import type { RedisLike } from "../api/types";
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

const SIZE_LABEL = {
  Replication: "Pods",
  Cluster: "Leaders (and as many followers)",
  Sentinel: "Sentinels",
  Standalone: "Pods",
};

export function confirmScale(object: RedisLike): void {
  const name = object.getName();
  const kind = kindOf(object);

  if (stop(kind === "Standalone" ? scaleRefusal(object, 1) : undefined)) return;

  let typed = String(object.spec.clusterSize ?? 1);

  confirmWrite({
    question: (
      <>
        Change the size of <b>{name}</b>?
      </>
    ),
    detail: `It has ${object.spec.clusterSize ?? 1}. The operator adds or removes pods to match.`,
    form: (
      <Field
        label={SIZE_LABEL[kind]}
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

      if (stop(scaleRefusal(object, count))) return;

      const warnings = scaleWarnings(object, count);

      try {
        await patchObject(object, scalePatch(object, count));
        notifyDone(
          `${name} scaled to ${count}.${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}`,
          {
            run: () => patchObject(object, scalePatch(object, object.spec.clusterSize ?? 1)),
          },
        );
      } catch (error) {
        failed(error, `scale ${name}`);
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

export function confirmRestartNode(object: RedisLike, nodes: RedisNode[], node: string): void {
  if (stop(memberRestartRefusal(object, nodes, node))) return;

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
        await deletePod(object, node);
        notifyDone(`Restart of ${node} requested.`);
      } catch (error) {
        failed(error, `restart ${node}`);
      }
    },
  });
}

export function confirmRestartAll(object: RedisLike, nodes: RedisNode[]): void {
  const name = object.getName();
  const plan = restartAllPlan(object, nodes);

  if ("refused" in plan) {
    Notifications.error(`${name} cannot be restarted pod by pod: ${plan.refused}`);
    return;
  }

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
      Notifications.info(`Restarting ${name}, one pod at a time.`);

      try {
        await runRestartAll(object, plan.steps, (done) =>
          Notifications.ok(`${name}: ${done}, done.`),
        );
        notifyDone(`Every pod of ${name} was restarted.`);
      } catch (error) {
        failed(error, `restart every pod of ${name}`);
      }
    },
  });
}

export function confirmFailover(
  replication: RedisLike,
  nodes: RedisNode[],
  sentinel: RedisLike | undefined,
  sentinelNodes: RedisNode[],
): void {
  if (stop(failoverRefusal(replication, nodes, sentinel, sentinelNodes))) return;

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
        failed(error, `fail ${name} over`);
      }
    },
  });
}
