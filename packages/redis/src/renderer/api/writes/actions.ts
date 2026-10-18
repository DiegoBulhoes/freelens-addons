import { Renderer } from "@freelensapp/extensions";
import { appSelector, kindOf, nodesOf, type RedisNode } from "../objects/nodes";
import {
  METADATA_ONLY,
  type PartialObjectMetadataList,
  type SecretListing,
  settledListings,
} from "../objects/upkeep";
import { RedisCluster, RedisReplication, RedisSentinel, RedisStandalone } from "../shared/kinds";
import { withTimeout } from "../shared/read-timeout";
import type { EventLike, PodLike, PvcLike, RedisKind, RedisLike } from "../shared/types";
import { execCollector } from "./exec";
import {
  describeStep,
  failoverCommand,
  isSettled,
  nodeRestartRefusalNow,
  podReplaced,
  type RestartStep,
  restartAllPlan,
  stepRefusal,
} from "./operations";

async function okJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  return (await response.json()) as T;
}

export const API_PROXY = "/api-kube";

const EXEC_TIMEOUT_MS = 15_000;

const KIND_CLASSES: Record<RedisKind, Pick<typeof RedisStandalone, "getApi">> = {
  Standalone: RedisStandalone,
  Replication: RedisReplication,
  Cluster: RedisCluster,
  Sentinel: RedisSentinel,
};

const apiOf = (object: RedisLike) => KIND_CLASSES[kindOf(object)].getApi();

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
    const frames = execCollector();
    const socket = new WebSocket(url, ["v4.channel.k8s.io"]);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${pod} did not answer within ${EXEC_TIMEOUT_MS / 1000}s`));
    }, EXEC_TIMEOUT_MS);

    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => frames.push(new Uint8Array(event.data as ArrayBuffer));
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not run a command in ${pod}`));
    };
    socket.onclose = () => {
      clearTimeout(timer);

      const { stdout, error } = frames.result();

      if (error) reject(new Error(error));
      else resolve(stdout);
    };
  });
}

export async function listSecretNames(namespaces: string[]): Promise<Map<string, SecretListing>> {
  const results = await Promise.allSettled(
    namespaces.map(async (namespace) => {
      const response = await withTimeout((signal) =>
        fetch(`${API_PROXY}/api/v1/namespaces/${namespace}/secrets`, {
          headers: { Accept: METADATA_ONLY },
          signal,
        }),
      );

      return okJson<PartialObjectMetadataList>(response);
    }),
  );

  return settledListings(namespaces, results);
}

/** The namespace's events but Normal ones, read while a drawer shows them: the host's store caps at 1000. */
export async function listWarningEvents(namespace: string): Promise<EventLike[]> {
  const selector = encodeURIComponent("type!=Normal");
  const response = await withTimeout((signal) =>
    fetch(`${API_PROXY}/api/v1/namespaces/${namespace}/events?fieldSelector=${selector}`, {
      signal,
    }),
  );

  return (await okJson<{ items?: EventLike[] }>(response)).items ?? [];
}

export async function patchObject(object: RedisLike, patch: object): Promise<void> {
  await apiOf(object).patch(descriptorOf(object), patch as never, "merge");
}

async function deletePod(object: RedisLike, pod: string): Promise<void> {
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

type FreshState = { object: RedisLike; nodes: RedisNode[] };

async function freshState(object: RedisLike): Promise<FreshState> {
  const read = (await apiOf(object).get(descriptorOf(object))) as unknown as RedisLike | undefined;

  if (!read) throw new Error(`${object.getName()} could not be read again`);

  const namespace = object.getNs() ?? "";
  const query = { labelSelector: appSelector(read) };
  const [pods, pvcs] = (await Promise.all([
    Renderer.K8sApi.podsApi.list({ namespace }, query),
    Renderer.K8sApi.pvcApi.list({ namespace }, query),
  ])) as unknown as [PodLike[] | null, PvcLike[] | null];

  return { object: read, nodes: nodesOf(read, pods ?? [], pvcs ?? []) };
}

/** Restarts one pod only if a read made now agrees with what was confirmed. */
export async function restartNode(
  object: RedisLike,
  node: string,
  confirmed: RedisNode["role"],
): Promise<void> {
  const now = await withTimeout(() => freshState(object));
  const refused = nodeRestartRefusalNow(now.object, now.nodes, node, confirmed);

  if (refused) throw new Error(refused);

  await deletePod(object, node);
}

/** A ticked row's turn can come minutes after it was ticked: its plan comes from a read made then. */
export async function freshPlan(
  object: RedisLike,
  read: (object: RedisLike) => Promise<FreshState> = freshState,
): Promise<RestartStep[]> {
  const now = await withTimeout(() => read(object));
  const plan = restartAllPlan(now.object, now.nodes);

  if ("refused" in plan) throw new Error(plan.refused);

  return plan.steps;
}

/** Polls `check`; one that hangs counts as not yet, so the step timeout still applies. */
export async function until(what: string, check: () => Promise<boolean>): Promise<void> {
  const started = Date.now();

  for (;;) {
    if (Date.now() - started > STEP_TIMEOUT_MS) {
      throw new Error(`${what} did not happen within 10 minutes; the rest was left as it was`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    if (await withTimeout(() => check()).catch(() => false)) return;
  }
}

async function restartStep(object: RedisLike, step: RestartStep): Promise<void> {
  const namespace = object.getNs();
  const now = await withTimeout(() => freshState(object));
  const refused = stepRefusal(now.object, step, now.nodes);

  if (refused) throw new Error(`Stopped before "${describeStep(step)}": ${refused}`);

  const uid = now.nodes.find((each) => each.name === step.node)?.pod?.metadata.uid ?? "";

  await deletePod(object, step.node);
  await until(`${step.node} coming back`, async () => {
    const pod = (await Renderer.K8sApi.podsApi.get({
      name: step.node,
      namespace,
    })) as unknown as PodLike | null;

    return podReplaced(pod ?? undefined, uid);
  });
  await until(`${object.getName()} settling after "${describeStep(step)}"`, async () => {
    const after = await freshState(object);

    return isSettled(after.object, after.nodes);
  });
}

/** One pod at a time, each checked against what the cluster says now, and the set left to settle. */
export async function runRestartAll(
  object: RedisLike,
  steps: RestartStep[],
  onStep: (step: RestartStep) => void,
): Promise<void> {
  for (const step of steps) {
    await restartStep(object, step);
    onStep(step);
  }
}
