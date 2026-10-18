import { objectKey } from "./selectors";
import type { EventLike } from "./types";

export const REJECTED_REASON = "InvalidConfiguration";
export const REJECTIONS_MS = 60_000;
const FIRST_RETRY_MS = 2_000;

export interface Rejection {
  message: string;
  at?: string;
  /** The uid of the object the Event is about. */
  uid?: string;
}

const timeOf = (event: EventLike) =>
  event.eventTime ?? event.lastTimestamp ?? event.metadata?.creationTimestamp ?? undefined;

/** Newest per object; Events expire and a TargetAllocator emits none, so a missing key means unknown. */
export function rejectionsFrom(events: EventLike[]): Map<string, Rejection> {
  const rejections = new Map<string, Rejection>();

  for (const event of events) {
    const object = event.regarding ?? event.involvedObject;

    if (event.reason !== REJECTED_REASON || !object?.kind || !object.name) continue;

    const key = objectKey(object.kind, object.namespace, object.name);
    const at = timeOf(event);
    const known = rejections.get(key);

    if (known?.at && at && known.at > at) continue;

    rejections.set(key, { message: event.note ?? event.message ?? "", at, uid: object.uid });
  }

  return rejections;
}

/** The Event's message, unless it is about an earlier object of that name or the object is loaded since. */
export function currentRejection(
  rejection: Rejection | undefined,
  uid: string | undefined,
  loaded: boolean,
): string | undefined {
  if (!rejection || loaded) return undefined;
  if (rejection.uid && uid && rejection.uid !== uid) return undefined;

  return rejection.message;
}

export interface RejectionRead {
  rejections: Map<string, Rejection>;
  /** Namespaces whose Events could not be listed, so a rejection there is not known. */
  refused: string[];
}

/** Each namespace's list on its own: one refusal must not hide the others' rejections. */
export function settleRejections(
  namespaces: string[],
  results: PromiseSettledResult<EventLike[]>[],
): RejectionRead {
  const events = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const refused = namespaces.filter((_, index) => results[index]?.status !== "fulfilled");

  return { rejections: rejectionsFrom(events), refused };
}

export function describeRefusedEvents(refused: string[]): string | undefined {
  if (refused.length === 0) return undefined;

  return `The operator's Events could not be read in ${[...refused].sort().join(", ")}, so a rejection there is not shown.`;
}

/** After `failures` reads in a row with a namespace refused, 2s doubling up to the regular read. */
export function nextRetryDelay(failures: number): number {
  if (failures <= 0) return REJECTIONS_MS;

  return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), REJECTIONS_MS);
}
