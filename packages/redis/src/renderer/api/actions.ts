import { Renderer } from "@freelensapp/extensions";

import { RedisCluster, RedisReplication, RedisSentinel, RedisStandalone } from "./kinds";
import { kindOf, nodesOf, type RedisNode } from "./nodes";
import {
  describeStep,
  failoverCommand,
  isSettled,
  type RestartStep,
  stepRefusal,
} from "./operations";
import type { PodLike, PvcLike, RedisLike, SecretMetaLike } from "./types";
import { METADATA_ONLY, type PartialObjectMetadataList, secretNamesFrom } from "./upkeep";

export const API_PROXY = "/api-kube";

const EXEC_TIMEOUT_MS = 15_000;

function apiOf(object: RedisLike) {
  switch (kindOf(object)) {
    case "Replication":
      return RedisReplication.getApi();
    case "Cluster":
      return RedisCluster.getApi();
    case "Sentinel":
      return RedisSentinel.getApi();
    default:
      return RedisStandalone.getApi();
  }
}

function descriptorOf(object: RedisLike) {
  return { name: object.getName(), namespace: object.getNs() };
}

/** Runs a command in a container through the API server, as kubectl exec does; returns stdout. */
export function execIn(
  namespace: string,
  pod: string,
  container: string,
  command: string[],
): Promise<string> {
  const query = new URLSearchParams([
    ["container", container],
    ...command.map((part) => ["command", part]),
    ["stdout", "true"],
    ["stderr", "true"],
  ]);
  const url = `${location.origin.replace(/^http/, "ws")}${API_PROXY}/api/v1/namespaces/${namespace}/pods/${pod}/exec?${query}`;

  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let stdout = "";
    let failure: string | undefined;
    const socket = new WebSocket(url, ["v4.channel.k8s.io"]);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${pod} did not answer within ${EXEC_TIMEOUT_MS / 1000}s`));
    }, EXEC_TIMEOUT_MS);

    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => {
      const frame = new Uint8Array(event.data as ArrayBuffer);
      const text = decoder.decode(frame.slice(1));

      if (frame[0] === 1) stdout += text;
      else if (frame[0] === 3 && text) {
        const status = JSON.parse(text) as { status?: string; message?: string };

        if (status.status !== "Success") failure = status.message ?? "the command failed";
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not exec into ${pod}; a failover needs pods/exec`));
    };
    socket.onclose = () => {
      clearTimeout(timer);

      if (failure) reject(new Error(failure));
      else resolve(stdout);
    };
  });
}

export async function listSecretNames(namespaces: string[]): Promise<SecretMetaLike[]> {
  const lists = await Promise.all(
    namespaces.map(async (namespace) => {
      const response = await fetch(`${API_PROXY}/api/v1/namespaces/${namespace}/secrets`, {
        headers: { Accept: METADATA_ONLY },
      });

      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

      return secretNamesFrom((await response.json()) as PartialObjectMetadataList);
    }),
  );

  return lists.flat();
}

export async function patchObject(object: RedisLike, patch: object): Promise<void> {
  await apiOf(object).patch(descriptorOf(object), patch as never, "merge");
}

export async function deletePod(object: RedisLike, pod: string): Promise<void> {
  await Renderer.K8sApi.podsApi.delete({ name: pod, namespace: object.getNs() });
}

/** SENTINEL FAILOVER, run in a ready sentinel pod; returns what redis-cli printed. */
export async function failover(sentinel: RedisLike, sentinelNodes: RedisNode[]): Promise<string> {
  const node = sentinelNodes.find((each) => each.ready && each.container);

  if (!node?.container) throw new Error(`No ready pod of ${sentinel.getName()} to ask`);

  const out = (
    await execIn(
      sentinel.getNs() ?? "default",
      node.name,
      node.container,
      failoverCommand(sentinel),
    )
  ).trim();

  if (!/^OK/.test(out)) throw new Error(out || "the sentinel did not answer OK");

  return out;
}

export async function openPodLog(object: RedisLike, node: RedisNode): Promise<boolean> {
  const pod = await Renderer.K8sApi.podsApi.get({ name: node.name, namespace: object.getNs() });
  const container =
    pod?.getContainers().find((each) => each.name === node.container) ?? pod?.getContainers()[0];

  if (!pod || !container) return false;

  Renderer.Component.logTabStore.createPodTab({ selectedPod: pod, selectedContainer: container });

  return true;
}

export async function openTerminal(title: string, command: string): Promise<void> {
  const tab = Renderer.Component.createTerminalTab({ title });

  await Renderer.Component.terminalStore.sendCommand(command, { enter: true, tabId: tab.id });
}

const POLL_MS = 3000;
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

async function fresh(object: RedisLike): Promise<{ object: RedisLike; nodes: RedisNode[] }> {
  const read = (await apiOf(object).get(descriptorOf(object))) as unknown as RedisLike | undefined;

  if (!read) throw new Error(`${object.getName()} could not be read again`);

  const namespace = object.getNs() ?? "";
  const pods = ((await Renderer.K8sApi.podsApi.list({ namespace })) ?? []) as unknown as PodLike[];
  const pvcs = ((await Renderer.K8sApi.pvcApi.list({ namespace })) ?? []) as unknown as PvcLike[];

  return { object: read, nodes: nodesOf(read, pods, pvcs) };
}

async function until(what: string, check: () => Promise<boolean>): Promise<void> {
  const started = Date.now();

  for (;;) {
    if (Date.now() - started > STEP_TIMEOUT_MS) {
      throw new Error(`${what} did not happen within 10 minutes; the rest was left as it was`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    if (await check().catch(() => false)) return;
  }
}

/** One pod at a time, each checked against what the cluster says now, and the set left to settle. */
export async function runRestartAll(
  object: RedisLike,
  steps: RestartStep[],
  onStep: (done: string) => void,
): Promise<void> {
  const namespace = object.getNs();

  for (const step of steps) {
    const now = await fresh(object);
    const refused = stepRefusal(now.object, step, now.nodes);

    if (refused) throw new Error(`Stopped before "${describeStep(step)}": ${refused}`);

    const deletedAt = Date.now();

    await Renderer.K8sApi.podsApi.delete({ name: step.node, namespace });
    await until(`${step.node} coming back`, async () => {
      const pod = (await Renderer.K8sApi.podsApi.get({
        name: step.node,
        namespace,
      })) as unknown as PodLike;

      return Date.parse(pod?.status?.startTime ?? "") >= deletedAt - 1000;
    });
    await until(`${object.getName()} settling after "${describeStep(step)}"`, async () => {
      const after = await fresh(object);

      return isSettled(after.object, after.nodes);
    });
    onStep(describeStep(step));
  }
}
