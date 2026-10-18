import { Renderer } from "@freelensapp/extensions";

import { AGENT_CONTAINER, type AgentView, agentViewOf, HEALTH_FILE } from "../clusters/agent";
import { membersOf } from "../clusters/members";
import { agentsOf, agentTargetsOf } from "../clusters/rows";
import { METADATA_ONLY, type PartialObjectMetadataList } from "../clusters/upkeep";
import { MongoDBCommunity } from "../shared/kinds";
import { withTimeout } from "../shared/read-timeout";
import type { AgentHealth, EventLike, PodLike, PvcLike, ReplicaSetLike } from "../shared/types";
import { execOutput } from "./exec";
import {
  checkedSwitchPatch,
  checkMemberRestart,
  describeStep,
  type FreshState,
  isSettled,
  memberSelector,
  podReplaced,
  type RestartStep,
  stepRefusal,
  whileRestartingAll,
} from "./operations";

async function okJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  return (await response.json()) as T;
}

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

  return agentViewOf(JSON.parse(text) as AgentHealth, pod);
}

/** Each namespace on its own, as metadata only: one refused or hung namespace leaves the others listed. */
export function listSecretNames(
  namespaces: string[],
): Promise<PromiseSettledResult<PartialObjectMetadataList>[]> {
  return Promise.allSettled(
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
}

/** Read while a drawer shows them: the host's event store holds at most 1000, cluster-wide. */
export async function listWarningEvents(namespace: string): Promise<EventLike[]> {
  const selector = encodeURIComponent("type!=Normal");
  const response = await withTimeout((signal) =>
    fetch(`${API_PROXY}/api/v1/namespaces/${namespace}/events?fieldSelector=${selector}`, {
      signal,
    }),
  );

  return (await okJson<{ items?: EventLike[] }>(response)).items ?? [];
}

export async function patchReplicaSet(rs: ReplicaSetLike, patch: object): Promise<void> {
  await MongoDBCommunity.getApi().patch(descriptorOf(rs), patch as never, "merge");
}

export async function deleteReplicaSet(rs: ReplicaSetLike): Promise<void> {
  await MongoDBCommunity.getApi().delete(descriptorOf(rs));
}

export async function restartMember(rs: ReplicaSetLike, member: string): Promise<void> {
  checkMemberRestart(await withTimeout(() => freshState(rs)), member);
  await Renderer.K8sApi.podsApi.delete({ name: member, namespace: rs.getNs() });
}

export async function switchPrimary(rs: ReplicaSetLike, target: string): Promise<void> {
  const patch = checkedSwitchPatch(await withTimeout(() => freshState(rs)), target);

  await patchReplicaSet(rs, patch);
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

/** The set and its members as the cluster has them now, read once for each check. */
async function freshState(rs: ReplicaSetLike): Promise<FreshState> {
  const fresh = await freshReplicaSet(rs);
  const namespace = rs.getNs() ?? "";
  const query = { labelSelector: memberSelector(rs) };
  const pods = ((await Renderer.K8sApi.podsApi.list({ namespace }, query)) ??
    []) as unknown as PodLike[];
  const pvcs = ((await Renderer.K8sApi.pvcApi.list({ namespace }, query)) ??
    []) as unknown as PvcLike[];
  const agents = Object.fromEntries(
    await Promise.all(
      agentTargetsOf([fresh], pods).map(async (key) => [
        key,
        await readAgentOf(namespace, key.slice(namespace.length + 1)).catch(() => undefined),
      ]),
    ),
  );

  return { rs: fresh, members: membersOf(fresh, pods, pvcs, agentsOf(fresh, agents)) };
}

async function until(what: string, check: () => Promise<boolean>): Promise<void> {
  const started = Date.now();

  for (;;) {
    if (Date.now() - started > STEP_TIMEOUT_MS) {
      throw new Error(`${what} did not happen within 10 minutes; the rest was left as it was`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    // A check that hangs counts as not yet, so the step's own deadline still holds.
    if (await withTimeout(() => check()).catch(() => false)) return;
  }
}

/** One step at a time, each checked against what the cluster says now, not what the page showed. */
export function runRestartAll(
  rs: ReplicaSetLike,
  steps: RestartStep[],
  onStep: (done: string) => void,
): Promise<void> {
  return whileRestartingAll(rs, () => restartInTurn(rs, steps, onStep));
}

async function restartInTurn(
  rs: ReplicaSetLike,
  steps: RestartStep[],
  onStep: (done: string) => void,
): Promise<void> {
  for (const step of steps) {
    await restartStep(rs, step);
    onStep(describeStep(step));
  }
}

async function restartStep(rs: ReplicaSetLike, step: RestartStep): Promise<void> {
  const namespace = rs.getNs();
  const { members } = await withTimeout(() => freshState(rs));
  const refused = stepRefusal(step, members);

  if (refused) throw new Error(`Stopped before "${describeStep(step)}": ${refused}`);

  const before = members.find((each) => each.name === step.member)?.pod?.metadata.uid;

  await Renderer.K8sApi.podsApi.delete({ name: step.member, namespace });
  await until(`${step.member} coming back Ready`, async () =>
    podReplaced(
      (await Renderer.K8sApi.podsApi.get({ name: step.member, namespace })) as unknown as PodLike,
      before,
    ),
  );
  // Back in the set, not only Ready: the next member goes only once this one has caught up.
  await until(`${rs.getName()} settling after "${describeStep(step)}"`, async () => {
    const now = await freshState(rs);

    return isSettled(now.rs, now.members);
  });
}

export function openHostList(path: string): void {
  Renderer.Navigation.navigate(path);
}
