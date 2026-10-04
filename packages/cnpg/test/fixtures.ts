import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KubeObject } from "@freelensapp/kube-object";
import type { Inventory } from "../src/renderer/api/attention";
import { type PartialObjectMetadataList, secretNamesFrom } from "../src/renderer/api/connection";

import { Backup, Cluster, ObjectStore, Pooler, ScheduledBackup } from "../src/renderer/api/kinds";
import type {
  BackupLike,
  ClusterLike,
  EventLike,
  InstanceStatus,
  ObjectStoreLike,
  PodDisruptionBudgetLike,
  PodLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SecretMetaLike,
  SubscriptionLike,
} from "../src/renderer/api/types";

import backupsJson from "./fixtures/backups.json";
import clustersJson from "./fixtures/clusters.json";
import eventsJson from "./fixtures/events.json";
import exportedAt from "./fixtures/exported-at.json";
import instanceStatusJson from "./fixtures/instance-status.json";
import objectStoresJson from "./fixtures/object-stores.json";
import pdbsJson from "./fixtures/pdbs.json";
import podsJson from "./fixtures/pods.json";
import poolersJson from "./fixtures/poolers.json";
import publicationsJson from "./fixtures/publications.json";
import scheduledBackupsJson from "./fixtures/scheduled-backups.json";
import secretNamesJson from "./fixtures/secret-names.json";
import subscriptionsJson from "./fixtures/subscriptions.json";

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export const clusters = () => build(Cluster, clustersJson) as unknown as ClusterLike[];
export const backups = () => build(Backup, backupsJson) as unknown as BackupLike[];
export const schedules = () =>
  build(ScheduledBackup, scheduledBackupsJson) as unknown as ScheduledBackupLike[];
export const poolers = () => build(Pooler, poolersJson) as unknown as PoolerLike[];
export const events = () => build(KubeObject, eventsJson) as unknown as EventLike[];
export const pods = () => build(KubeObject, podsJson) as unknown as PodLike[];
export const objectStores = () =>
  build(ObjectStore, objectStoresJson) as unknown as ObjectStoreLike[];

export function inventory(): Inventory {
  return {
    clusters: clusters(),
    backups: backups(),
    schedules: schedules(),
    poolers: poolers(),
    objectStores: objectStores(),
  };
}

function named<T extends { getName(): string }>(items: T[], name: string): T {
  const found = items.find((item) => item.getName() === name);

  if (!found) throw new Error(`no object named ${name} in the fixtures`);

  return found;
}

export const clusterNamed = (name: string) => named(clusters(), name);
export const poolerNamed = (name: string) => named(poolers(), name);
export const scheduleNamed = (name: string) => named(schedules(), name);

// A real object with one field changed, for a state the cluster did not produce.
// biome-ignore lint/suspicious/noExplicitAny: a variant edits one field of whatever shape the kind has
export function variantOf<T extends object>(original: T, change: (raw: any) => void): T {
  const raw = JSON.parse(JSON.stringify(original));

  change(raw);

  return new (original.constructor as new (data: unknown) => T)(raw);
}

export function fixtureNow(): number {
  return Date.parse(exportedAt.exportedAt);
}

export const pdbs = () => build(KubeObject, pdbsJson) as unknown as PodDisruptionBudgetLike[];
export const publications = () =>
  build(KubeObject, publicationsJson) as unknown as PublicationLike[];
export const subscriptions = () =>
  build(KubeObject, subscriptionsJson) as unknown as SubscriptionLike[];

/** Each running instance's /pg/status, by pod name. */
export function instanceStatus(pod: string): InstanceStatus {
  const found = (
    instanceStatusJson as { items: { pod: string; status: InstanceStatus }[] }
  ).items.find((item) => item.pod === pod);

  if (!found) throw new Error(`no status for ${pod} in the fixtures`);

  return JSON.parse(JSON.stringify(found.status)) as InstanceStatus;
}

export const postgresLog = () =>
  readFileSync(resolve(__dirname, "fixtures/postgres-log.txt"), "utf8");

export const secrets = (): SecretMetaLike[] =>
  secretNamesFrom(secretNamesJson as unknown as PartialObjectMetadataList);
