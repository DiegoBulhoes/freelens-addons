import { type ChainInputs, chainOf, explanationOf } from "../certificates/chain";
import type { CertificateLike } from "../shared/types";
import { type RenewalVerdict, renewalVerdict } from "./renewal";

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

function verdictIn(inputs: ChainInputs, certificate: CertificateLike): RenewalVerdict {
  return renewalVerdict(certificate, explanationOf(chainOf(certificate, inputs)));
}

export function renewalRefusal(inputs: ChainInputs) {
  return (certificate: CertificateLike): string | undefined => {
    const verdict = verdictIn(inputs, certificate);

    return verdict.offer ? undefined : verdict.reason;
  };
}

export function renewalWarning(inputs: ChainInputs) {
  return (certificate: CertificateLike): string | undefined => {
    const verdict = verdictIn(inputs, certificate);

    return verdict.offer ? verdict.warning : undefined;
  };
}

const SHOWN = 8;

export function listNames(list: string[]): string {
  return list.length > SHOWN
    ? `${list.slice(0, SHOWN).join(", ")} and ${list.length - SHOWN} more`
    : list.join(", ");
}

/** What the confirmation warns of among what it will act on; undefined when nothing. */
export function planWarning<Item>(
  ready: Item[],
  warnOf: ((item: Item) => string | undefined) | undefined,
  nameOf: (item: Item) => string,
): string | undefined {
  if (!warnOf) return undefined;

  const warned = ready.flatMap((item) => {
    const warning = warnOf(item);

    return warning ? [`${nameOf(item)}: ${warning}`] : [];
  });

  if (warned.length === 0) return undefined;

  return warned.length > SHOWN
    ? `${warned.slice(0, SHOWN).join(" ")} And ${warned.length - SHOWN} more like these.`
    : warned.join(" ");
}

export function describeOutcome(verb: string, done: number, failed: string[]): string {
  const what = `${verb} ${done} of ${done + failed.length}.`;

  return failed.length === 0 ? what : `${what} Failed: ${failed.join("; ")}.`;
}
