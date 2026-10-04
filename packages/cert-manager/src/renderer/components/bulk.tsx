import { Renderer } from "@freelensapp/extensions";

import { describeOutcome, planFor } from "../api/bulk";
import { confirmWrite } from "./confirm";
import type { SelectionAction } from "./selection-bar";
import { CertManagerStyles } from "./styles";

const {
  Component: { Notifications },
} = Renderer;

const SHOWN = 8;

function names(list: string[]): string {
  return list.length > SHOWN
    ? `${list.slice(0, SHOWN).join(", ")} and ${list.length - SHOWN} more`
    : list.join(", ");
}

/** A selection-bar action: plans over the ticked items, lists what it skips and why, asks for "confirm". */
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
    run: (picked) => {
      const plan = planFor(picked, spec.refuse ?? (() => undefined));

      if (plan.ready.length === 0) {
        Notifications.error(
          `Nothing to ${spec.label.toLowerCase()}: ${plan.skipped.map(({ item, reason }) => `${spec.nameOf(item)}: ${reason}`).join(" ")}`,
        );
        return;
      }

      const count = plan.ready.length;

      confirmWrite({
        question: (
          <>
            {spec.label} {count} {spec.kind}
            {count === 1 ? "" : "s"}?
          </>
        ),
        detail: (
          <>
            {names(plan.ready.map(spec.nameOf))}.{spec.detail ? ` ${spec.detail}` : ""}
            {plan.skipped.length > 0 && (
              <>
                <br />
                Skipped:{" "}
                {plan.skipped
                  .map(({ item, reason }) => `${spec.nameOf(item)} (${reason})`)
                  .join(" ")}
              </>
            )}
          </>
        ),
        label: `${spec.label} ${count}`,
        destructive: spec.caution === true,
        typed: () => "confirm",
        ok: async () => {
          const failed: string[] = [];
          let succeeded = 0;

          // One at a time: a failure leaves the rest to report on, not a half-sent batch.
          for (const item of plan.ready) {
            try {
              await spec.run(item);
              succeeded += 1;
            } catch (error) {
              failed.push(
                `${spec.nameOf(item)} (${error instanceof Error ? error.message : String(error)})`,
              );
            }
          }

          const message = describeOutcome(spec.done, succeeded, failed);

          if (failed.length === 0) Notifications.ok(message);
          else
            Notifications.error(
              <div className="CertManager CertManager-dialog">
                <CertManagerStyles />
                {message}
              </div>,
            );
        },
      });
    },
  };
}
