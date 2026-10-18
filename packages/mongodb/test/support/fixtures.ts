import { KubeObject } from "@freelensapp/kube-object";

import { type AgentView, agentViewOf } from "../../src/renderer/api/clusters/agent";
import type { Inventory } from "../../src/renderer/api/clusters/rows";
import {
  type PartialObjectMetadataList,
  type SecretNames,
  settledSecretNames,
} from "../../src/renderer/api/clusters/upkeep";
import { MongoDBCommunity } from "../../src/renderer/api/shared/kinds";
import type {
  AgentHealth,
  EventLike,
  PodLike,
  PvcLike,
  ReplicaSetLike,
} from "../../src/renderer/api/shared/types";

import agentHealthJson from "../fixtures/agent-health.json";
import eventsJson from "../fixtures/events.json";
import exportedAt from "../fixtures/exported-at.json";
import podsJson from "../fixtures/pods.json";
import pvcsJson from "../fixtures/pvcs.json";
import replicaSetsJson from "../fixtures/replica-sets.json";
import secretNamesJson from "../fixtures/secret-names.json";

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export const NOW = Date.parse(exportedAt.exportedAt);

export const replicaSets = () =>
  build(MongoDBCommunity, replicaSetsJson) as unknown as ReplicaSetLike[];
export const pods = () => build(KubeObject, podsJson) as unknown as PodLike[];
export const pvcs = () => build(KubeObject, pvcsJson) as unknown as PvcLike[];
// As the drawer lists them: plain JSON from the API, not host objects.
export const events = () => structuredClone((eventsJson as Raw).items) as EventLike[];

/** Each member's raw agent-health-status.json, keyed by pod. */
export function healthOf(pod: string): AgentHealth {
  const found = (
    agentHealthJson as unknown as { items: { pod: string; health: AgentHealth }[] }
  ).items.find((each) => each.pod === pod);

  if (!found) throw new Error(`no agent health for ${pod} in the fixture`);

  return found.health;
}

/** As useAgents gives them: "namespace/pod". */
export function agents(): Record<string, AgentView | undefined> {
  return Object.fromEntries(
    (
      agentHealthJson as unknown as {
        items: { namespace: string; pod: string; health: AgentHealth }[];
      }
    ).items.map((each) => [`${each.namespace}/${each.pod}`, agentViewOf(each.health, each.pod)]),
  );
}

const secretList = secretNamesJson as unknown as PartialObjectMetadataList;

/** The listing split by namespace, as each namespace's own read answers it. */
export function secretListings(): { namespaces: string[]; lists: PartialObjectMetadataList[] } {
  const namespaces = [
    ...new Set((secretList.items ?? []).map((item) => item.metadata?.namespace ?? "")),
  ].sort();

  return {
    namespaces,
    lists: namespaces.map((namespace) => ({
      items: (secretList.items ?? []).filter((item) => item.metadata?.namespace === namespace),
    })),
  };
}

export function secrets(): SecretNames {
  const { namespaces, lists } = secretListings();

  return settledSecretNames(
    namespaces,
    lists.map((value) => ({ status: "fulfilled" as const, value })),
  );
}

export function inventory(): Inventory {
  return {
    replicaSets: replicaSets(),
    pods: pods(),
    podsRead: "read",
    pvcs: pvcs(),
    secrets: secrets(),
    agents: agents(),
  };
}

export function named<T extends { getName(): string }>(items: T[], name: string): T {
  const found = items.find((each) => each.getName() === name);

  if (!found) throw new Error(`no ${name} in the fixture`);

  return found;
}
