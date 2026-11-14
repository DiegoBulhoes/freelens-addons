import { clusterIdFromHost, stateFileName } from "./cluster-scope";
import { hydrate, onStateChange, snapshot } from "./local-state";

// Not localStorage, which a new origin port wipes every launch. Main holds the file: the frame has no Node.

/** Main's side of the state file, reached over IPC. */
export interface StateFileAccess {
  read(fileName: string): Promise<string | undefined>;
  write(fileName: string, text: string): Promise<void>;
}

// Every extension's onActivate is awaited in one Promise.all: a hang here stalls them all.
const ANSWER_TIMEOUT_MS = 5_000;

const UNREACHABLE = Symbol("unreachable");

let target: { files: StateFileAccess; fileName: string } | undefined;
let writes: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | undefined;

/** Never rejects; on failure the state stays in memory. */
export async function startPersistingState(files: StateFileAccess, host: string): Promise<void> {
  const fileName = stateFileName(clusterIdFromHost(host));

  // The root frame: no cluster, no UI of ours.
  if (fileName === undefined) return;

  const loaded = await firstReadOrNothing(files, fileName);

  if (loaded === UNREACHABLE) return;

  target = { files, fileName };

  try {
    if (loaded !== undefined) hydrate(JSON.parse(loaded));
  } catch {
    // Not JSON: start empty.
  }

  unsubscribe = onStateChange(() => {
    writes = writes.then(writeSnapshot);
  });
}

export async function flushState(): Promise<void> {
  unsubscribe?.();
  unsubscribe = undefined;

  await writes;
}

async function firstReadOrNothing(
  files: StateFileAccess,
  fileName: string,
): Promise<string | undefined | typeof UNREACHABLE> {
  const timedOut = Symbol("timed out");

  try {
    const answer = await Promise.race([
      files.read(fileName),
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), ANSWER_TIMEOUT_MS),
      ),
    ]);

    if (answer === timedOut) {
      console.error("[argocd] operator state did not answer; pins stay in memory");

      return UNREACHABLE;
    }

    return answer;
  } catch (error) {
    console.error("[argocd] no operator state file; pins stay in memory", error);

    return UNREACHABLE;
  }
}

/** Writes are chained, so main never gets two at once for one file. */
async function writeSnapshot(): Promise<void> {
  if (target === undefined) return;

  const { files, fileName } = target;

  try {
    await files.write(fileName, JSON.stringify(snapshot(), null, 2));
  } catch (error) {
    console.error(`[argocd] could not hand operator state ${fileName} to main`, error);
  }
}
