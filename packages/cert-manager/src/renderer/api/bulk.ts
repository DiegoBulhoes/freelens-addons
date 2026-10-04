import { type ChainInputs, chainOf, explanationOf } from "./chain";
import { renewalVerdict } from "./renewal";
import type { CertificateLike } from "./types";

export interface Plan<Item> {
  ready: Item[];
  skipped: { item: Item; reason: string }[];
}

/** Splits a selection into what an action applies to and what it would refuse, with why. */
export function planFor<Item>(
  items: Item[],
  refuse: (item: Item) => string | undefined,
): Plan<Item> {
  const plan: Plan<Item> = { ready: [], skipped: [] };

  for (const item of items) {
    const reason = refuse(item);

    if (reason) plan.skipped.push({ item, reason });
    else plan.ready.push(item);
  }

  return plan;
}

export function renewalRefusal(inputs: ChainInputs) {
  return (certificate: CertificateLike): string | undefined => {
    const verdict = renewalVerdict(certificate, explanationOf(chainOf(certificate, inputs)));

    return verdict.offer ? undefined : verdict.reason;
  };
}

export function describeOutcome(verb: string, done: number, failed: string[]): string {
  const what = `${verb} ${done} of ${done + failed.length}.`;

  return failed.length === 0 ? what : `${what} Failed: ${failed.join("; ")}.`;
}
