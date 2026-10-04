import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import { describeEachOutcome, listNames, type Plan, planFor } from "../api/bulk";
import { confirmWrite } from "./confirm";
import type { SelectionAction } from "./selection-bar";
import { ArgoCDStyles } from "./styles";

const {
  Component: { Notifications },
} = Renderer;

export interface BulkWrite<Item> {
  nameOf: (item: Item) => string;
  verb: string;
  done: string;
  kind: string;
  plan: Plan<Item>;
  detail?: string;
  form?: ReactNode;
  destructive: boolean;
  /** False for a write that changes nothing in the cluster. */
  typed?: boolean;
  run: (item: Item) => Promise<void>;
}

/** One write over several objects: lists what it reaches and what it skips, and asks for "confirm". */
export function confirmBulk<Item>(write: BulkWrite<Item>): void {
  const { plan, nameOf } = write;

  if (plan.ready.length === 0) {
    Notifications.error(
      `Nothing to ${write.verb.toLowerCase()}: ${plan.skipped.map(({ item, reason }) => `${nameOf(item)}, ${reason}`).join("; ")}.`,
    );
    return;
  }

  const count = plan.ready.length;

  confirmWrite({
    question: (
      <>
        {write.verb} {count} {write.kind}
        {count === 1 ? "" : "s"}?
      </>
    ),
    detail: (
      <>
        {listNames(plan.ready.map(nameOf))}.{write.detail ? ` ${write.detail}` : ""}
        {plan.skipped.length > 0 && (
          <>
            <br />
            Skipped:{" "}
            {plan.skipped.map(({ item, reason }) => `${nameOf(item)} (${reason})`).join(", ")}.
          </>
        )}
      </>
    ),
    form: write.form,
    label: `${write.verb} ${count}`,
    destructive: write.destructive,
    typed: write.typed === false ? undefined : () => "confirm",
    ok: async () => {
      const failed: string[] = [];
      let succeeded = 0;

      // One at a time: a failure leaves the rest to report on, not a half-sent batch.
      for (const item of plan.ready) {
        try {
          await write.run(item);
          succeeded += 1;
        } catch {
          failed.push(nameOf(item));
        }
      }

      const message = describeEachOutcome(write.done, succeeded, failed);

      if (failed.length === 0) Notifications.ok(message);
      else
        Notifications.error(
          <div className="ArgoCD ArgoCD-dialog">
            <ArgoCDStyles />
            {message}
          </div>,
        );
    },
  });
}

/** A selection-bar action that plans over the ticked items and confirms with "confirm". */
export function bulkAction<Item>(spec: {
  label: string;
  done: string;
  kind: string;
  tooltip: string;
  caution?: boolean;
  nameOf: (item: Item) => string;
  refuse?: (item: Item) => string | undefined;
  detail?: string;
  run: (item: Item) => Promise<void>;
}): SelectionAction<Item> {
  return {
    label: spec.label,
    tooltip: `${spec.tooltip} Asks you to type "confirm"`,
    caution: spec.caution,
    run: (picked) =>
      confirmBulk({
        nameOf: spec.nameOf,
        verb: spec.label,
        done: spec.done,
        kind: spec.kind,
        plan: planFor(picked, spec.refuse ?? (() => undefined)),
        detail: spec.detail,
        destructive: spec.caution === true,
        run: spec.run,
      }),
  };
}
