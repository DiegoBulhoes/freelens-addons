import { Renderer } from "@freelensapp/extensions";

import { describeOutcome, type Plan, planFor } from "../api/bulk";
import { confirmWrite } from "./confirm";
import type { SelectionAction } from "./selection-bar";
import { CNPGStyles } from "./styles";

const {
  Component: { Notifications },
} = Renderer;

const SHOWN = 8;

function names(list: string[]): string {
  return list.length > SHOWN
    ? `${list.slice(0, SHOWN).join(", ")} and ${list.length - SHOWN} more`
    : list.join(", ");
}

/** One write over several objects: lists what it reaches and what it skips, and asks for "confirm". */
export function confirmBulk<Item>({
  nameOf,
  verb,
  done,
  kind,
  plan,
  detail,
  destructive,
  run,
}: {
  nameOf: (item: Item) => string;
  verb: string;
  done: string;
  kind: string;
  plan: Plan<Item>;
  detail?: string;
  destructive: boolean;
  run: (item: Item) => Promise<void>;
}): void {
  if (plan.ready.length === 0) {
    Notifications.error(
      `Nothing to ${verb.toLowerCase()}: ${plan.skipped.map(({ item, reason }) => `${nameOf(item)}: ${reason}`).join(" ")}`,
    );
    return;
  }

  const count = plan.ready.length;

  confirmWrite({
    question: (
      <>
        {verb} {count} {kind}
        {count === 1 ? "" : "s"}?
      </>
    ),
    detail: (
      <>
        {names(plan.ready.map(nameOf))}.{detail ? ` ${detail}` : ""}
        {plan.skipped.length > 0 && (
          <>
            <br />
            Skipped:{" "}
            {plan.skipped.map(({ item, reason }) => `${nameOf(item)} (${reason})`).join(" ")}
          </>
        )}
      </>
    ),
    label: `${verb} ${count}`,
    destructive,
    typed: () => "confirm",
    ok: async () => {
      const failed: string[] = [];
      let succeeded = 0;

      // One at a time: a failure leaves the rest to report on, not a half-sent batch.
      for (const item of plan.ready) {
        try {
          await run(item);
          succeeded += 1;
        } catch {
          failed.push(nameOf(item));
        }
      }

      const message = describeOutcome(done, succeeded, failed);

      if (failed.length === 0) Notifications.ok(message);
      else
        Notifications.error(
          <div className="CNPG CNPG-dialog">
            <CNPGStyles />
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
