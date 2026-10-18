import { KubeObject } from "@freelensapp/kube-object";
import type { Inventory } from "../../src/renderer/api/objects/rows";
import {
  type PartialObjectMetadataList,
  type SecretListings,
  secretNamesFrom,
} from "../../src/renderer/api/objects/upkeep";
import {
  RedisCluster,
  RedisReplication,
  RedisSentinel,
  RedisStandalone,
} from "../../src/renderer/api/shared/kinds";
import type {
  EventLike,
  PodLike,
  PvcLike,
  RedisLike,
  SecretMetaLike,
} from "../../src/renderer/api/shared/types";

import clustersJson from "../fixtures/clusters.json";
import eventsJson from "../fixtures/events.json";
import exportedAt from "../fixtures/exported-at.json";
import podsJson from "../fixtures/pods.json";
import pvcsJson from "../fixtures/pvcs.json";
import replicationsJson from "../fixtures/replications.json";
import secretNamesJson from "../fixtures/secret-names.json";
import sentinelsJson from "../fixtures/sentinels.json";
import standalonesJson from "../fixtures/standalones.json";

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export const NOW = Date.parse(exportedAt.exportedAt);

export const objects = (): RedisLike[] =>
  [
    ...build(RedisStandalone, standalonesJson),
    ...build(RedisReplication, replicationsJson),
    ...build(RedisCluster, clustersJson),
    ...build(RedisSentinel, sentinelsJson),
  ] as unknown as RedisLike[];
export const pods = () => build(KubeObject, podsJson) as unknown as PodLike[];
export const pvcs = () => build(KubeObject, pvcsJson) as unknown as PvcLike[];
// Plain JSON, as the drawer lists them.
export const events = () => (eventsJson as Raw).items as EventLike[];
export const secrets = (): SecretMetaLike[] =>
  secretNamesFrom(secretNamesJson as unknown as PartialObjectMetadataList);

/** The redis namespace's listing, the only one with a TLS object. */
export const secretListings = (): SecretListings => new Map([["redis", secrets()]]);

export function inventory(): Inventory {
  return {
    objects: objects(),
    pods: pods(),
    pvcs: pvcs(),
    podsRead: true,
    secrets: secretListings(),
  };
}

export function named(name: string): RedisLike {
  const found = objects().find((each) => each.getName() === name);

  if (!found) throw new Error(`no ${name} in the fixture`);

  return found;
}

/** A real object with one field changed: shapes a live cluster also produces. */
export function variantOf(
  object: RedisLike,
  change: Partial<Pick<RedisLike, "spec" | "status">>,
  ns?: string,
): RedisLike {
  return {
    ...object,
    kind: object.kind,
    getName: () => object.getName(),
    getNs: () => (ns === undefined ? object.getNs() : ns || undefined),
    spec: change.spec ?? object.spec,
    status: "status" in change ? change.status : object.status,
  };
}
