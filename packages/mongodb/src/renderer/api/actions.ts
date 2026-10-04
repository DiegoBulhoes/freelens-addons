import { Renderer } from "@freelensapp/extensions";

import { AGENT_CONTAINER, type AgentView, execOutput, HEALTH_FILE, readAgent } from "./agent";
import { MongoDBCommunity } from "./kinds";
import { membersOf } from "./members";
import { describeStep, isSettled, podBackAfter, type RestartStep, stepRefusal } from "./operations";
import type { AgentHealth, PodLike, PvcLike, ReplicaSetLike, SecretMetaLike } from "./types";
import { METADATA_ONLY, type PartialObjectMetadataList, secretNamesFrom } from "./upkeep";

export const API_PROXY = "/api-kube";

const EXEC_TIMEOUT_MS = 10_000;

function descriptorOf(rs: ReplicaSetLike) {
  return { name: rs.getName(), namespace: rs.getNs() };
}

/** Runs a command in a container through the API server, as kubectl exec does, and returns stdout. */
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
    const frames: Uint8Array[] = [];
    const socket = new WebSocket(url, ["v4.channel.k8s.io"]);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${pod} did not answer within ${EXEC_TIMEOUT_MS / 1000}s`));
    }, EXEC_TIMEOUT_MS);

    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => frames.push(new Uint8Array(event.data as ArrayBuffer));
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not exec into ${pod}; reading members needs pods/exec`));
    };
    socket.onclose = () => {
      clearTimeout(timer);
      const { stdout, error } = execOutput(frames);

      if (error) reject(new Error(error));
      else resolve(stdout);
    };
  });
}

export async function readAgentOf(namespace: string, pod: string): Promise<AgentView | undefined> {
  const text = await execIn(namespace, pod, AGENT_CONTAINER, ["cat", HEALTH_FILE]);

  return readAgent(JSON.parse(text) as AgentHealth, pod);
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

export async function patchReplicaSet(rs: ReplicaSetLike, patch: object): Promise<void> {
  await MongoDBCommunity.getApi().patch(descriptorOf(rs), patch as never, "merge");
}

export async function deleteReplicaSet(rs: ReplicaSetLike): Promise<void> {
  await MongoDBCommunity.getApi().delete(descriptorOf(rs));
}

export async function deleteMemberPod(rs: ReplicaSetLike, member: string): Promise<void> {
  await Renderer.K8sApi.podsApi.delete({ name: member, namespace: rs.getNs() });
}

export async function openMemberLog(
  rs: ReplicaSetLike,
  member: string,
  container: "mongod" | "mongodb-agent",
): Promise<boolean> {
  const pod = await Renderer.K8sApi.podsApi.get({ name: member, namespace: rs.getNs() });
  const found = pod?.getContainers().find((each) => each.name === container);

  if (!pod || !found) return false;

  Renderer.Component.logTabStore.createPodTab({ selectedPod: pod, selectedContainer: found });

  return true;
}

export async function openTerminal(title: string, command: string): Promise<void> {
  const tab = Renderer.Component.createTerminalTab({ title });

  await Renderer.Component.terminalStore.sendCommand(command, { enter: true, tabId: tab.id });
}

const POLL_MS = 3000;
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

async function freshReplicaSet(rs: ReplicaSetLike): Promise<ReplicaSetLike> {
  const fresh = (await MongoDBCommunity.getApi().get(descriptorOf(rs))) as unknown as
    | ReplicaSetLike
    | undefined;

  if (!fresh) throw new Error(`${rs.getName()} could not be read again`);

  return fresh;
}

async function freshMembers(rs: ReplicaSetLike) {
  const fresh = await freshReplicaSet(rs);

  const namespace = rs.getNs() ?? "";
  const pods = ((await Renderer.K8sApi.podsApi.list({ namespace })) ?? []) as unknown as PodLike[];
  const pvcs = ((await Renderer.K8sApi.pvcApi.list({ namespace })) ?? []) as unknown as PvcLike[];
  const names = pods
    .map((pod) => pod.getName())
    .filter((name) => name.startsWith(`${rs.getName()}-`));
  const agents = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readAgentOf(namespace, name).catch(() => undefined)]),
    ),
  );

  return membersOf(fresh, pods, pvcs, agents);
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

/** One step at a time, each checked against what the cluster says now, not what the page showed. */
export async function runRestartAll(
  rs: ReplicaSetLike,
  steps: RestartStep[],
  onStep: (done: string) => void,
): Promise<void> {
  const namespace = rs.getNs();

  for (const step of steps) {
    const refused = stepRefusal(step, await freshMembers(rs));

    if (refused) throw new Error(`Stopped before "${describeStep(step)}": ${refused}`);

    const deletedAt = Date.now();

    await Renderer.K8sApi.podsApi.delete({ name: step.member, namespace });
    await until(`${step.member} coming back Ready`, async () =>
      podBackAfter(
        (await Renderer.K8sApi.podsApi.get({ name: step.member, namespace })) as unknown as PodLike,
        deletedAt,
      ),
    );
    // Back in the set, not only Ready: the next member goes only once this one has caught up.
    await until(`${rs.getName()} settling after "${describeStep(step)}"`, async () =>
      isSettled(await freshReplicaSet(rs), await freshMembers(rs)),
    );
    onStep(describeStep(step));
  }
}
