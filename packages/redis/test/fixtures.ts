import { KubeObject } from "@freelensapp/kube-object";

import {
  RedisCluster,
  RedisReplication,
  RedisSentinel,
  RedisStandalone,
} from "../src/renderer/api/kinds";
import type { Inventory } from "../src/renderer/api/rows";
import type {
  EventLike,
  PodLike,
  PvcLike,
  RedisLike,
  SecretMetaLike,
} from "../src/renderer/api/types";
import { type PartialObjectMetadataList, secretNamesFrom } from "../src/renderer/api/upkeep";

import clustersJson from "./fixtures/clusters.json";
import eventsJson from "./fixtures/events.json";
import exportedAt from "./fixtures/exported-at.json";
import podsJson from "./fixtures/pods.json";
import pvcsJson from "./fixtures/pvcs.json";
import replicationsJson from "./fixtures/replications.json";
import secretNamesJson from "./fixtures/secret-names.json";
import sentinelsJson from "./fixtures/sentinels.json";
import standalonesJson from "./fixtures/standalones.json";

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
export const events = () => build(KubeObject, eventsJson) as unknown as EventLike[];
export const secrets = (): SecretMetaLike[] =>
  secretNamesFrom(secretNamesJson as unknown as PartialObjectMetadataList);

export function inventory(): Inventory {
  return { objects: objects(), pods: pods(), pvcs: pvcs(), secrets: secrets() };
}

export function named(name: string): RedisLike {
  const found = objects().find((each) => each.getName() === name);

  if (!found) throw new Error(`no ${name} in the fixture`);

  return found;
}
