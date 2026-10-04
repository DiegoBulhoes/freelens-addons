import { KubeObject } from "@freelensapp/kube-object";

import { type AgentView, readAgent } from "../src/renderer/api/agent";
import { MongoDBCommunity } from "../src/renderer/api/kinds";
import type { Inventory } from "../src/renderer/api/rows";
import type {
  AgentHealth,
  EventLike,
  PodLike,
  PvcLike,
  ReplicaSetLike,
  SecretMetaLike,
} from "../src/renderer/api/types";
import { type PartialObjectMetadataList, secretNamesFrom } from "../src/renderer/api/upkeep";

import agentHealthJson from "./fixtures/agent-health.json";
import eventsJson from "./fixtures/events.json";
import exportedAt from "./fixtures/exported-at.json";
import podsJson from "./fixtures/pods.json";
import pvcsJson from "./fixtures/pvcs.json";
import replicaSetsJson from "./fixtures/replica-sets.json";
import secretNamesJson from "./fixtures/secret-names.json";

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export const NOW = Date.parse(exportedAt.exportedAt);

export const replicaSets = () =>
  build(MongoDBCommunity, replicaSetsJson) as unknown as ReplicaSetLike[];
export const pods = () => build(KubeObject, podsJson) as unknown as PodLike[];
export const pvcs = () => build(KubeObject, pvcsJson) as unknown as PvcLike[];
export const events = () => build(KubeObject, eventsJson) as unknown as EventLike[];

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
    ).items.map((each) => [`${each.namespace}/${each.pod}`, readAgent(each.health, each.pod)]),
  );
}

export const secrets = (): SecretMetaLike[] =>
  secretNamesFrom(secretNamesJson as unknown as PartialObjectMetadataList);

export function inventory(): Inventory {
  return {
    replicaSets: replicaSets(),
    pods: pods(),
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
